import { TelegramClient, Api } from 'telegram'
import { computeCheck } from 'telegram/Password'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import { DeletedMessage } from 'telegram/events/DeletedMessage'
import { CustomFile } from 'telegram/client/uploads'
import { BrowserWindow } from 'electron'
import { appStore } from '../storage/store'
import { twitterDriver } from '../drivers/twitter'
import { ContentPipeline } from './pipeline'
import { Account, MirrorLogItem, TelegramAuthCodeSubmit, TelegramAuthRequest } from '../../shared/types'

export interface MediaItem {
  buffer: Buffer
  mimeType?: string
}

export class TelegramMirrorService {
  private client: TelegramClient | null = null
  private isRunning: boolean = false
  private authClient: TelegramClient | null = null
  private twitterCheckInterval: NodeJS.Timeout | null = null
  private processedTwitterIds = new Set<string>()
  private initializedTwitterSync = new Set<string>()
  private albumBuffers = new Map<
    string,
    {
      groupedId: string
      chat: any
      chatId: string
      chatUsername: string
      chatTitle: string
      messageIds: number[]
      rawTexts: string[]
      attributionSource: { username?: string; name?: string }
      messageDate: Date
      mediaBuffers: MediaItem[]
      timer?: NodeJS.Timeout
    }
  >()

  public getStatus() {
    const rules = appStore.getRules().filter((r) => r.enabled)
    return {
      running: this.isRunning,
      engineRunning: this.isRunning,
      activeRulesCount: rules.length
    }
  }

  /**
   * Request Telegram login code via SMS or Telegram App
   */
  async requestCode(req: TelegramAuthRequest): Promise<{ phoneCodeHash: string }> {
    const session = new StringSession('')
    this.authClient = new TelegramClient(session, req.apiId, req.apiHash, {
      connectionRetries: 5
    })
    await this.authClient.connect()

    const { phoneCodeHash } = await this.authClient.sendCode(
      {
        apiId: req.apiId,
        apiHash: req.apiHash
      },
      req.phoneNumber
    )

    return { phoneCodeHash }
  }

  /**
   * Complete Telegram login with SMS/App code
   */
  async submitCode(
    authInfo: TelegramAuthRequest,
    submit: TelegramAuthCodeSubmit
  ): Promise<Account> {
    if (!this.authClient) {
      throw new Error('当前没有活跃的 Telegram 验证会话，请先获取验证码。')
    }

    try {
      await this.authClient.invoke(
        new Api.auth.SignIn({
          phoneNumber: submit.phoneNumber,
          phoneCodeHash: submit.phoneCodeHash,
          phoneCode: submit.code.trim()
        })
      )
    } catch (err: any) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        if (!submit.password) {
          throw new Error('该 Telegram 账号开启了两步验证 (2FA)，请输入两步验证密码后再点击完成。')
        }
        const passwordSrpResult = await this.authClient.invoke(new Api.account.GetPassword())
        const passwordSrpCheck = await computeCheck(passwordSrpResult, submit.password.trim())
        await this.authClient.invoke(
          new Api.auth.CheckPassword({
            password: passwordSrpCheck
          })
        )
      } else {
        let msg = err.errorMessage || err.message || 'Telegram 验证失败'
        if (msg === 'PHONE_CODE_INVALID') {
          msg = '验证码错误 (PHONE_CODE_INVALID)，请核对后重试'
        } else if (msg === 'PHONE_CODE_EXPIRED') {
          msg = '验证码已过期 (PHONE_CODE_EXPIRED)，请返回重新获取'
        } else if (msg === 'PASSWORD_HASH_INVALID') {
          msg = '两步验证密码错误 (PASSWORD_HASH_INVALID)，请核对后重试'
        }
        throw new Error(msg)
      }
    }

    const me = (await this.authClient.getMe()) as any
    const sessionString = (this.authClient.session.save() as unknown) as string

    const account: Account = {
      id: `tg_${me.id}`,
      platform: 'telegram',
      username: me.username ? `@${me.username}` : me.phone || `${me.id}`,
      displayName: [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Telegram User',
      status: 'active',
      lastChecked: new Date().toISOString(),
      credentials: {
        apiId: authInfo.apiId,
        apiHash: authInfo.apiHash,
        sessionString,
        phoneNumber: submit.phoneNumber
      }
    }

    appStore.saveAccount(account)
    this.authClient = null
    return account
  }

  /**
   * Start listening to Telegram channels and mirroring to target platforms
   */
  async start(): Promise<boolean> {
    if (this.isRunning) return true

    const tgAccount = appStore.getAccounts().find((a) => a.platform === 'telegram' && a.status === 'active')
    if (!tgAccount || !tgAccount.credentials.sessionString || !tgAccount.credentials.apiId || !tgAccount.credentials.apiHash) {
      console.warn('[Mirror] No active Telegram account found')
      return false
    }

    try {
      const session = new StringSession(tgAccount.credentials.sessionString)
      this.client = new TelegramClient(session, tgAccount.credentials.apiId, tgAccount.credentials.apiHash, {
        connectionRetries: 10
      })

      await this.client.connect()
      this.isRunning = true

      console.log('[Mirror] Connected to Telegram as', tgAccount.username)

      // Register new message listener
      this.client.addEventHandler(async (event: any) => {
        try {
          await this.handleIncomingMessage(event)
        } catch (err) {
          console.error('[Mirror] Error handling message:', err)
        }
      }, new NewMessage({}))

      // Register deleted message listener (Auto-delete mirrored posts)
      this.client.addEventHandler(async (event: any) => {
        try {
          await this.handleDeletedMessages(event)
        } catch (err) {
          console.error('[Mirror] Error handling deleted messages:', err)
        }
      }, new DeletedMessage({}))

      // Start bidirectional deletion checker (X -> TG)
      this.startBidirectionalDeletionChecker()

      this.notifyStatusChange()
      return true
    } catch (err) {
      console.error('[Mirror] Failed to start Telegram listener:', err)
      this.isRunning = false
      this.notifyStatusChange()
      return false
    }
  }

  /**
   * Stop Telegram mirror listener
   */
  async stop(): Promise<boolean> {
    this.stopBidirectionalDeletionChecker()
    if (this.client) {
      try {
        await this.client.disconnect()
      } catch (e) {
        // ignore
      }
      this.client = null
    }
    this.isRunning = false
    this.notifyStatusChange()
    return true
  }

  /**
   * Handle incoming message event from Telegram.
   * If message belongs to an album (groupedId), debounces and aggregates all media and caption
   * into a single unified post before dispatching to Twitter.
   */
  private async handleIncomingMessage(event: any): Promise<void> {
    const message = event.message
    if (!message || (!message.message && !message.media)) return

    const chat = await message.getChat()
    const rawText = message.message || ''

    const chatUsername = chat?.username ? `@${chat.username}` : ''
    const chatId = chat?.id?.toString() || ''
    const chatTitle = chat?.title || chatUsername || 'Channel'
    const messageDate = message.date ? new Date(message.date * 1000) : new Date()

    // Determine the attribution source (Forward origin, or current channel)
    let attributionSource: { username?: string; name?: string } = {}

    if (message.fwdFrom) {
      if (message.fwdFrom.fromName) {
        attributionSource = { name: message.fwdFrom.fromName }
      } else if (message.fwdFrom.fromId && this.client) {
        try {
          const entity: any = await this.client.getEntity(message.fwdFrom.fromId)
          if (entity?.username) {
            attributionSource = { username: entity.username }
          } else {
            const displayName =
              entity?.title ||
              [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') ||
              ''
            attributionSource = { name: displayName }
          }
        } catch (e) {
          console.warn('[Mirror] Failed to fetch forward entity:', e)
        }
      }
    }

    // If not a forwarded message (or failed to get forward source), use current channel
    if (!attributionSource.username && !attributionSource.name) {
      if (chat?.username) {
        attributionSource = { username: chat.username }
      } else {
        attributionSource = { name: chat?.title || chatTitle }
      }
    }

    // Download media buffer if present
    let downloadedMedia: MediaItem | null = null
    if (message.media && this.client) {
      try {
        const buf = await this.client.downloadMedia(message, {})
        if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
          let mimeType = 'image/jpeg'
          if (
            message.video ||
            message.media?.document?.mimeType?.startsWith('video/')
          ) {
            mimeType = message.media?.document?.mimeType || 'video/mp4'
          } else if (message.media?.document?.mimeType) {
            mimeType = message.media.document.mimeType
          }
          downloadedMedia = { buffer: buf, mimeType }
        }
      } catch (err) {
        console.warn('[Mirror] Failed to download media from Telegram:', err)
      }
    }

    // Check if message belongs to an album (groupedId)
    const groupedId = message.groupedId ? message.groupedId.toString() : null

    if (groupedId) {
      let album = this.albumBuffers.get(groupedId)
      if (!album) {
        album = {
          groupedId,
          chat,
          chatId,
          chatUsername,
          chatTitle,
          messageIds: [],
          rawTexts: [],
          attributionSource,
          messageDate,
          mediaBuffers: []
        }
        this.albumBuffers.set(groupedId, album)
      }

      if (album.timer) {
        clearTimeout(album.timer)
      }

      album.messageIds.push(message.id)
      if (rawText.trim()) {
        album.rawTexts.push(rawText.trim())
      }
      if (downloadedMedia) {
        album.mediaBuffers.push(downloadedMedia)
      }
      if (!album.attributionSource.username && !album.attributionSource.name) {
        album.attributionSource = attributionSource
      }

      // Wait 1200ms for sibling media messages to arrive before publishing
      album.timer = setTimeout(() => {
        this.flushAlbum(groupedId)
      }, 1200)

      return
    }

    // Single individual post: process immediately
    await this.processAggregatedMessage({
      chat,
      chatId,
      chatUsername,
      chatTitle,
      messageIds: [message.id],
      rawText,
      mediaBuffers: downloadedMedia ? [downloadedMedia] : [],
      attributionSource,
      messageDate
    })
  }

  /**
   * Flush and publish an entire aggregated album of media
   */
  private async flushAlbum(groupedId: string): Promise<void> {
    const album = this.albumBuffers.get(groupedId)
    if (!album) return
    this.albumBuffers.delete(groupedId)

    const rawText = album.rawTexts.join('\n\n') || ''
    console.log(
      `[Mirror] Album ${groupedId} aggregated ${album.mediaBuffers.length} images and ${album.messageIds.length} messages. Processing mirror...`
    )

    await this.processAggregatedMessage({
      chat: album.chat,
      chatId: album.chatId,
      chatUsername: album.chatUsername,
      chatTitle: album.chatTitle,
      messageIds: album.messageIds,
      rawText,
      mediaBuffers: album.mediaBuffers,
      attributionSource: album.attributionSource,
      messageDate: album.messageDate
    })
  }

  /**
   * Process and mirror an aggregated message (with full set of media) to target platforms
   */
  private async processAggregatedMessage(params: {
    chat: any
    chatId: string
    chatUsername: string
    chatTitle: string
    messageIds: number[]
    rawText: string
    mediaBuffers: MediaItem[]
    attributionSource: { username?: string; name?: string }
    messageDate: Date
  }): Promise<void> {
    const {
      chat,
      chatId,
      chatUsername,
      chatTitle,
      messageIds,
      rawText,
      mediaBuffers,
      attributionSource,
      messageDate
    } = params

    // Find all matching enabled rules (match against username, channel title, or channel ID)
    const rules = appStore.getRules().filter((r) => {
      if (!r.enabled) return false
      const source = (r.sourceChannel.username || r.sourceChannel.title || '')
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/^https?:\/\/t\.me\//, '')
        .trim()
      const incomingUsername = (chat?.username || '').toLowerCase().replace(/^@/, '').trim()
      const incomingTitle = (chat?.title || '').toLowerCase().trim()
      const incomingId = (chat?.id?.toString() || '').replace(/^-100/, '')

      return (
        (incomingUsername && source === incomingUsername) ||
        (incomingTitle && (source === incomingTitle || incomingTitle.includes(source))) ||
        (r.sourceChannel.id && (r.sourceChannel.id === chatId || r.sourceChannel.id.replace(/^-100/, '') === incomingId))
      )
    })

    if (rules.length === 0) return

    for (const rule of rules) {
      const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      const targetAccount = appStore.getAccount(rule.targetAccount.accountId)

      if (!targetAccount) {
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: rule.targetAccount.platform,
          originalText: rawText || (mediaBuffers.length > 0 ? `[全套图片 - 共 ${mediaBuffers.length} 张]` : '(Media Message)'),
          processedText: '',
          mediaCount: 0,
          status: 'failed',
          errorMessage: 'Target account not found'
        })
        continue
      }

      // Process content through pipeline with attribution footer (RT: t.me/xxx or RT: Name 西元xxx)
      const { text: processedText, shouldDrop } = ContentPipeline.process(
        rawText,
        rule.filters,
        attributionSource,
        messageDate
      )

      if (shouldDrop && mediaBuffers.length === 0) {
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: rule.targetAccount.platform,
          originalText: rawText || '(Media Message)',
          processedText: '(Filtered by content rules)',
          mediaCount: 0,
          status: 'filtered'
        })
        continue
      }

      // Dispatch to Twitter/X
      if (rule.targetAccount.platform === 'twitter') {
        // Upload all media attachments to Twitter (images or videos)
        const mediaIds: string[] = []
        if (rule.filters.forwardMedia !== false && mediaBuffers.length > 0) {
          console.log(`[Mirror] Uploading ${mediaBuffers.length} media attachments to X...`)
          for (const item of mediaBuffers) {
            try {
              const upRes = await twitterDriver.uploadMedia(targetAccount, item.buffer, item.mimeType)
              if (upRes.success && upRes.mediaId) {
                mediaIds.push(upRes.mediaId)
              }
            } catch (err) {
              console.warn('[Mirror] Failed to upload media to Twitter:', err)
            }
          }
        }

        const tweetContent =
          processedText ||
          ContentPipeline.formatAttribution(
            attributionSource,
            rule.filters.attributionStyle || 'RT',
            messageDate
          )

        // Publish full batch of images (up to 6 per tweet, dynamically chained into thread if >6 or API restricted)
        const publishRes = await twitterDriver.publishPostWithMedia(
          targetAccount,
          tweetContent,
          mediaIds,
          rule.filters.autoSplitThread !== false
        )

        // Update rule stats
        rule.stats.totalReceived += 1
        if (publishRes.success) {
          rule.stats.totalForwarded += 1
          rule.stats.lastMirroredAt = new Date().toISOString()

          // Track mapping for all message IDs in the album for automatic synchronized deletion
          const targetTweetIds = publishRes.tweetIds || (publishRes.tweetId ? [publishRes.tweetId] : [])
          if (targetTweetIds.length > 0) {
            for (const msgId of messageIds) {
              appStore.saveMirroredPost({
                id: `mp_${Date.now()}_${msgId}_${Math.random().toString(36).substring(2, 6)}`,
                ruleId: rule.id,
                telegramChannelId: chatId,
                telegramChannelUsername: chatUsername,
                telegramMessageId: msgId,
                targetPlatform: 'twitter',
                targetAccountId: targetAccount.id,
                targetTweetIds,
                createdAt: new Date().toISOString()
              })
            }
          }
        }
        appStore.saveRule(rule)

        // Record log
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: 'twitter',
          originalText: rawText || (mediaBuffers.length > 0 ? `[全套图片 - 共 ${mediaBuffers.length} 张]` : '(Media Message)'),
          processedText: tweetContent,
          mediaCount: mediaIds.length,
          status: publishRes.success ? 'success' : 'failed',
          errorMessage: publishRes.error,
          targetUrl: publishRes.url
        })
      }
    }
  }

  /**
   * Handle deleted messages from Telegram channels and automatically delete mirrored posts
   */
  private async handleDeletedMessages(event: any): Promise<void> {
    const deletedIds: number[] = event.deletedIds || (event.id ? [event.id] : [])
    if (!deletedIds || deletedIds.length === 0) return

    let channelId = ''
    if (event.peer?.channelId) {
      channelId = event.peer.channelId.toString()
    } else if (event.chatId) {
      channelId = event.chatId.toString()
    }

    console.log(
      `[Mirror] Telegram delete event detected for IDs: [${deletedIds.join(', ')}] in channel: ${
        channelId || 'all/global'
      }`
    )

    for (const msgId of deletedIds) {
      // Find mirrored post mappings
      let matchedRecords = channelId
        ? appStore.findMirroredPostsByTelegram(channelId, msgId)
        : []

      // Fallback: check by msgId if channelId not provided in update
      if (matchedRecords.length === 0) {
        matchedRecords = appStore.findMirroredPostsByMessageId(msgId)
      }

      if (matchedRecords.length === 0) continue

      for (const record of matchedRecords) {
        const rule = appStore.getRule(record.ruleId)
        if (rule && rule.filters.autoSyncDeletion === false) {
          console.log(`[Mirror] Rule "${rule.name}" has autoSyncDeletion disabled, skipping.`)
          continue
        }

        const targetAccount = appStore.getAccount(record.targetAccountId)
        if (!targetAccount) continue

        if (record.targetPlatform === 'twitter' && record.targetTweetIds?.length > 0) {
          console.log(
            `[Mirror] Auto-deleting mirrored Twitter post [${record.targetTweetIds.join(
              ', '
            )}] for Telegram msg #${msgId}`
          )

          const delRes = await twitterDriver.deleteThread(targetAccount, record.targetTweetIds)

          const logId = `log_del_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: record.ruleId,
            sourceChannel: record.telegramChannelUsername || record.telegramChannelId || 'Telegram Channel',
            targetPlatform: 'twitter',
            originalText: `[消息被撤回/删除] 源电报频道删除了消息 #${msgId}`,
            processedText: `[自动同步删除] 已在 X / Twitter 上删除对应的 ${delRes.deletedCount} 条推文`,
            mediaCount: 0,
            status: 'deleted'
          })

          appStore.deleteMirroredPost(record.id)
        }
      }
    }
  }

  private startBidirectionalDeletionChecker(): void {
    if (this.twitterCheckInterval) clearInterval(this.twitterCheckInterval)
    // Run initial baseline check after 2s
    setTimeout(() => {
      this.syncTwitterToTelegram().catch((e) => console.warn('[Mirror] Initial sync error:', e))
    }, 2000)

    // Check every 15 seconds
    this.twitterCheckInterval = setInterval(async () => {
      if (!this.isRunning || !this.client) return
      try {
        await this.checkTwitterDeletions()
      } catch (err) {
        console.warn('[Mirror] Error during bidirectional deletion check:', err)
      }
      try {
        await this.syncTwitterToTelegram()
      } catch (err) {
        console.warn('[Mirror] Error during Twitter->TG mirror sync:', err)
      }
    }, 15000)
  }

  private stopBidirectionalDeletionChecker(): void {
    if (this.twitterCheckInterval) {
      clearInterval(this.twitterCheckInterval)
      this.twitterCheckInterval = null
    }
  }

  /**
   * Scan mirrored posts: if tweet was deleted on X, delete corresponding message in Telegram!
   */
  async checkTwitterDeletions(): Promise<void> {
    const mirrored = (appStore as any).data?.mirroredPosts || []
    if (mirrored.length === 0) return

    // Check recent mirrored posts
    const recent = mirrored.slice(-25)

    for (const record of recent) {
      const rule = appStore.getRule(record.ruleId)
      if (rule && rule.filters.autoSyncDeletion === false) continue

      const targetAccount = appStore.getAccount(record.targetAccountId)
      if (!targetAccount || targetAccount.platform !== 'twitter') continue

      const primaryTweetId = record.targetTweetIds?.[0]
      if (!primaryTweetId) continue

      const exists = await twitterDriver.checkTweetExists(targetAccount, primaryTweetId)
      if (!exists) {
        console.log(
          `[Mirror] Detected tweet ${primaryTweetId} was deleted on X! Sync-deleting TG message #${record.telegramMessageId}...`
        )

        // Delete from Telegram channel
        const tgDeleted = await this.deleteTelegramMessage(
          record.telegramChannelId || record.telegramChannelUsername || '',
          record.telegramMessageId
        )

        const logId = `log_bi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: record.ruleId,
          sourceChannel: record.telegramChannelUsername || record.telegramChannelId || 'Telegram Channel',
          targetPlatform: 'telegram',
          originalText: `[双向同步撤回] X / Twitter 上的推文已删除`,
          processedText: tgDeleted
            ? `[自动同步撤回] 已从 Telegram 频道撤回对应消息 #${record.telegramMessageId}`
            : `[撤回完成] 检测到 X 推文已删除，已同步清理映射记录`,
          mediaCount: 0,
          status: 'deleted'
        })

        // Remove mapping from store
        appStore.deleteMirroredPost(record.id)
      }
    }
  }

  /**
   * Delete a message in a Telegram channel (for bidirectional deletion)
   */
  async deleteTelegramMessage(channelIdentifier: string, messageId: number): Promise<boolean> {
    if (!this.client || !this.isRunning) return false
    try {
      let entity: any = channelIdentifier
      if (/^-?\d+$/.test(channelIdentifier)) {
        entity = await this.client.getEntity(channelIdentifier)
      }
      await this.client.deleteMessages(entity, [messageId], { revoke: true })
      console.log(`[Mirror] Successfully deleted Telegram message #${messageId} in ${channelIdentifier}`)
      return true
    } catch (err) {
      console.warn(`[Mirror] Failed to delete Telegram message #${messageId}:`, err)
      return false
    }
  }

  /**
   * Bidirectional Mirroring: Sync new tweets posted on X back to Telegram channel
   */
  async syncTwitterToTelegram(): Promise<void> {
    if (!this.client || !this.isRunning) return
    const rules = appStore.getRules().filter((r) => r.enabled)
    if (rules.length === 0) return

    for (const rule of rules) {
      const targetAccount = appStore.getAccount(rule.targetAccount.accountId)
      if (!targetAccount || targetAccount.platform !== 'twitter') continue

      const tweets = await twitterDriver.fetchRecentTweets(targetAccount, 10)
      if (!tweets || tweets.length === 0) continue

      // Baseline initialization on startup: cache current tweets so old historical posts aren't spammed to Telegram
      if (!this.initializedTwitterSync.has(rule.id)) {
        tweets.forEach((t) => this.processedTwitterIds.add(t.tweetId))
        this.initializedTwitterSync.add(rule.id)
        console.log(
          `[Mirror] Initialized X->TG baseline for rule "${rule.name}" (${tweets.length} baseline tweets cached)`
        )
        continue
      }

      for (const tweet of tweets) {
        if (this.processedTwitterIds.has(tweet.tweetId)) continue

        // Check if this tweet was created by Rosetta (exists in mirroredPosts) to prevent echo loop
        const allMirrored = appStore.getMirroredPosts()
        const isEcho = allMirrored.some((p) => p.targetTweetIds?.includes(tweet.tweetId))
        if (isEcho) {
          this.processedTwitterIds.add(tweet.tweetId)
          continue
        }

        console.log(`[Mirror] New tweet #${tweet.tweetId} detected on X! Mirroring to Telegram channel...`)
        this.processedTwitterIds.add(tweet.tweetId)

        // Format message: text + ID & Link footer
        const date = tweet.createdAt || new Date()
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const hours = String(date.getHours()).padStart(2, '0')
        const mins = String(date.getMinutes()).padStart(2, '0')

        const tweetUrl = `https://x.com/${tweet.author}/status/${tweet.tweetId}`
        const attribution = `RT: ${tweetUrl} 西元${year}年${month}月${day}日 ${hours}:${mins}`
        const tgText = tweet.text ? `${tweet.text}\n\n${attribution}` : attribution

        // Download media (photos or videos)
        const mediaFiles: CustomFile[] = []
        if (tweet.media && tweet.media.length > 0) {
          for (let i = 0; i < tweet.media.length; i++) {
            const m = tweet.media[i]
            try {
              const downloadUrl = m.videoUrl || m.url
              const mRes = await fetch(downloadUrl)
              if (mRes.ok) {
                const arrayBuf = await mRes.arrayBuffer()
                const buf = Buffer.from(arrayBuf)
                const ext = m.type === 'video' ? 'mp4' : 'jpg'
                mediaFiles.push(new CustomFile(`media_${i}.${ext}`, buf.length, '', buf))
              }
            } catch (err) {
              console.warn('[Mirror] Failed to download tweet media for Telegram:', err)
            }
          }
        }

        // Send to Telegram channel
        try {
          const channelIdentifier =
            rule.sourceChannel.username || rule.sourceChannel.title || rule.sourceChannel.id || ''
          let entity: any = channelIdentifier
          if (/^-?\d+$/.test(channelIdentifier)) {
            entity = await this.client.getEntity(channelIdentifier)
          }

          let sentMsg: any
          if (mediaFiles.length > 0) {
            sentMsg = await this.client.sendFile(entity, {
              file: mediaFiles.length === 1 ? mediaFiles[0] : mediaFiles,
              caption: tgText
            })
          } else {
            sentMsg = await this.client.sendMessage(entity, {
              message: tgText
            })
          }

          const sentMsgId = Array.isArray(sentMsg) ? sentMsg[0].id : sentMsg.id
          console.log(`[Mirror] Successfully mirrored tweet #${tweet.tweetId} to Telegram msg #${sentMsgId}`)

          // Save mapping for auto-sync deletion and loop prevention
          appStore.saveMirroredPost({
            id: `mp_x2tg_${Date.now()}_${tweet.tweetId}`,
            ruleId: rule.id,
            telegramChannelId: rule.sourceChannel.id || '',
            telegramChannelUsername: rule.sourceChannel.username,
            telegramMessageId: sentMsgId,
            targetPlatform: 'twitter',
            targetAccountId: targetAccount.id,
            targetTweetIds: [tweet.tweetId],
            createdAt: new Date().toISOString()
          })

          const logId = `log_x2tg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            sourceChannel: `@${tweet.author} (X / Twitter)`,
            targetPlatform: 'telegram',
            originalText: tweet.text || '(X Post)',
            processedText: tgText,
            mediaCount: mediaFiles.length,
            status: 'success',
            targetUrl: tweetUrl
          })
        } catch (err: any) {
          console.error('[Mirror] Failed to send tweet to Telegram channel:', err)
          const logId = `log_x2tg_err_${Date.now()}`
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            sourceChannel: `@${tweet.author} (X / Twitter)`,
            targetPlatform: 'telegram',
            originalText: tweet.text || '(X Post)',
            processedText: '',
            mediaCount: mediaFiles.length,
            status: 'failed',
            errorMessage: err.message || 'Failed to send to Telegram channel'
          })
        }
      }
    }
  }

  private emitLog(log: MirrorLogItem): void {
    appStore.addLog(log)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('mirror:log-added', log)
    })
  }

  private notifyStatusChange(): void {
    const status = this.getStatus()
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('mirror:status-changed', status)
    })
  }
}

export const telegramMirrorService = new TelegramMirrorService()
