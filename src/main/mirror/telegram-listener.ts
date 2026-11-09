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
  isVideo?: boolean
}

export class TelegramMirrorService {
  private client: TelegramClient | null = null
  private isRunning: boolean = false
  private authClient: TelegramClient | null = null
  private twitterCheckInterval: NodeJS.Timeout | null = null
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
    const running = Boolean(this.isRunning && this.client && !(this.client as any)._destroyed)
    const rules = appStore.getRules().filter((r) => r.enabled)
    return {
      running,
      engineRunning: running,
      activeRulesCount: rules.length
    }
  }

  public getClient(): TelegramClient | null {
    return this.client
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

      // Automatically fetch avatar and profile info in background
      this.fetchUserProfile(tgAccount).then((profile) => {
        if (profile.avatarUrl || profile.displayName) {
          if (profile.avatarUrl) tgAccount.avatarUrl = profile.avatarUrl
          if (profile.displayName) tgAccount.displayName = profile.displayName
          appStore.saveAccount(tgAccount)
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('accounts:updated', tgAccount)
            }
          })
        }
      }).catch(() => {})

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

    // Download media buffer if present (supports photos, videos, gifs, voice/audio)
    let downloadedMedia: MediaItem | null = null
    if (message.media && this.client) {
      try {
        const isDocVideo =
          Boolean(message.video) ||
          message.media?.document?.mimeType?.startsWith('video/') ||
          message.media?.document?.attributes?.some((a: any) => a.className === 'DocumentAttributeVideo') ||
          (message.file?.name && /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(message.file.name))

        let mimeType = isDocVideo ? message.media?.document?.mimeType || 'video/mp4' : 'image/jpeg'
        if (isDocVideo && !mimeType.startsWith('video/')) {
          mimeType = 'video/mp4'
        } else if (!isDocVideo && message.media?.document?.mimeType) {
          mimeType = message.media.document.mimeType
        }

        const buf = await this.client.downloadMedia(message, {})
        if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
          downloadedMedia = { buffer: buf, mimeType, isVideo: isDocVideo }
        }
      } catch (err: any) {
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

      // Fast debounce (750ms) for sibling media messages to arrive before publishing
      album.timer = setTimeout(() => {
        this.flushAlbum(groupedId)
      }, 750)

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

    if (rules.length === 0) {
      console.log(
        `[Mirror] Ignored message from "${chatTitle}" (${chatUsername || 'ID:' + chatId}): no matching enabled rule found.`
      )
      return
    }

    console.log(
      `[Mirror] Processing message from "${chatTitle}" for ${rules.length} matching rule(s). Media count: ${mediaBuffers.length}`
    )

    for (const rule of rules) {
      const startTime = Date.now()
      const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      const targetAccount = appStore.getAccount(rule.targetAccount.accountId)

      if (!targetAccount) {
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: rule.targetAccount.platform,
          originalText: rawText || (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
          processedText: '',
          mediaCount: 0,
          status: 'failed',
          errorMessage: 'Target account not found',
          durationMs: Date.now() - startTime
        })
        continue
      }

      // Immediately emit processing log for live UI feedback
      this.emitLog({
        id: logId,
        timestamp: new Date().toISOString(),
        ruleId: rule.id,
        sourceChannel: chatTitle,
        targetPlatform: rule.targetAccount.platform,
        originalText: rawText || (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
        processedText: mediaBuffers.length > 0 ? `正在并发上传 ${mediaBuffers.length} 项附件并同步至 X / Twitter...` : '正在同步至 X / Twitter...',
        mediaCount: mediaBuffers.length,
        status: 'processing'
      })

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
          status: 'filtered',
          durationMs: Date.now() - startTime
        })
        continue
      }

      // Dispatch to Twitter/X
      if (rule.targetAccount.platform === 'twitter') {
        try {
          // Upload all media attachments (photos & chunked videos) to Twitter in parallel
          const mediaItems: Array<{ mediaId: string; isVideo?: boolean }> = []
          if (rule.filters.forwardMedia !== false && mediaBuffers.length > 0) {
            console.log(`[Mirror] Uploading ${mediaBuffers.length} media attachments to X in parallel...`)
            const uploadPromises = mediaBuffers.map((item) =>
              twitterDriver
                .uploadMedia(targetAccount, item.buffer, item.mimeType)
                .then((res) =>
                  res.success && res.mediaId
                    ? { mediaId: res.mediaId, isVideo: item.isVideo }
                    : null
                )
                .catch((err) => {
                  console.warn('[Mirror] Failed to upload media to Twitter:', err)
                  return null
                })
            )
            const uploaded = await Promise.all(uploadPromises)
            mediaItems.push(
              ...uploaded.filter((m): m is { mediaId: string; isVideo?: boolean } => Boolean(m))
            )
          }

          const tweetContent =
            processedText ||
            ContentPipeline.formatAttribution(
              attributionSource,
              rule.filters.attributionStyle || 'RT',
              messageDate
            )

          // Publish media: videos isolated to dedicated tweets, images grouped, threaded if necessary
          const publishRes = await twitterDriver.publishPostWithMedia(
            targetAccount,
            tweetContent,
            mediaItems,
            rule.filters.autoSplitThread !== false
          )

          // Update rule stats
          rule.stats.totalReceived += 1
          if (publishRes.success) {
            rule.stats.totalForwarded += 1
            rule.stats.lastMirroredAt = new Date().toISOString()

            // Track mapping for all message IDs in the album for automatic synchronized deletion
            const targetTweetIds =
              publishRes.tweetIds || (publishRes.tweetId ? [publishRes.tweetId] : [])
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

          // Record log with duration (always emit, even if publishRes.success === false)
          const durationMs = Date.now() - startTime
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            sourceChannel: chatTitle,
            targetPlatform: 'twitter',
            originalText:
              rawText ||
              (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
            processedText: publishRes.success ? tweetContent : (processedText || '转发推文失败'),
            mediaCount: mediaItems.length,
            status: publishRes.success ? 'success' : 'failed',
            errorMessage: publishRes.error,
            targetUrl: publishRes.url,
            durationMs
          })
        } catch (dispatchErr: any) {
          console.error(`[Mirror] Rule "${rule.name}" encountered fatal error:`, dispatchErr)
          const durationMs = Date.now() - startTime
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            sourceChannel: chatTitle,
            targetPlatform: 'twitter',
            originalText:
              rawText ||
              (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
            processedText: '转发流程发生异常',
            mediaCount: mediaBuffers.length,
            status: 'failed',
            errorMessage: dispatchErr?.message || String(dispatchErr) || '未知转发异常',
            durationMs
          })
        }
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
    // Check every 15 seconds if mirrored tweets were deleted on X
    this.twitterCheckInterval = setInterval(async () => {
      if (!this.isRunning || !this.client) return
      try {
        await this.checkTwitterDeletions()
      } catch (err) {
        console.warn('[Mirror] Error during deletion sync check:', err)
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
    const mirrored = appStore.getMirroredPosts()
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
   * Fetch recent N messages from a Telegram channel
   */
  async getChannelRecentMessages(channelIdentifier: string, limit = 5): Promise<Array<{
    id: number
    date: string
    text: string
    hasMedia: boolean
    mediaType?: string
    url?: string
  }>> {
    const cleanChan = channelIdentifier.replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '').trim()

    if (this.client && this.isRunning) {
      try {
        let entity: any = channelIdentifier
        if (/^-?\d+$/.test(channelIdentifier)) {
          entity = await this.client.getEntity(channelIdentifier)
        } else {
          entity = await this.client.getInputEntity(channelIdentifier)
        }
        const msgs = await this.client.getMessages(entity, { limit })
        if (Array.isArray(msgs) && msgs.length > 0) {
          return msgs.map((m: any) => {
            let mediaType: string | undefined = undefined
            if (m.video || m.media?.document?.mimeType?.startsWith('video/')) mediaType = 'video'
            else if (m.photo) mediaType = 'photo'
            else if (m.media) mediaType = 'document'

            return {
              id: m.id,
              date: m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString(),
              text: m.message || (m.media ? '[多媒体内容]' : ''),
              hasMedia: Boolean(m.media),
              mediaType,
              url: cleanChan ? `https://t.me/${cleanChan}/${m.id}` : undefined
            }
          })
        }
      } catch (e: any) {
        console.warn(`[TelegramMirrorService] MTProto getMessages failed for ${channelIdentifier}:`, e.message)
      }
    }

    // Fallback: load from botPosts store
    const botPosts = appStore.getBotPosts()
    const norm = cleanChan.toLowerCase()
    const matched = botPosts
      .filter((p) => {
        const pNorm = p.chatId.replace(/^-100/, '').replace(/^@/, '').toLowerCase()
        return !cleanChan || pNorm === norm || p.chatId.includes(norm)
      })
      .slice(0, limit)

    return matched.map((p) => ({
      id: p.messageId,
      date: p.sentAt,
      text: p.text,
      hasMedia: p.mediaCount > 0,
      mediaType: p.mediaType === 'video' ? 'video' : p.mediaType === 'photo' || p.mediaType === 'album' ? 'photo' : undefined,
      url: p.postUrl
    }))
  }

  /**
   * Fetch current Telegram user profile (displayName, avatarUrl)
   */
  async fetchUserProfile(account: Account): Promise<{ displayName?: string; avatarUrl?: string }> {
    if (!this.client || !this.isRunning) {
      if (!account.credentials.sessionString || !account.credentials.apiId || !account.credentials.apiHash) {
        return {}
      }
      try {
        const session = new StringSession(account.credentials.sessionString)
        const tempClient = new TelegramClient(session, account.credentials.apiId, account.credentials.apiHash, {
          connectionRetries: 3
        })
        await tempClient.connect()
        const me: any = await tempClient.getMe()
        const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || account.displayName
        let avatarUrl: string | undefined = undefined
        const photo = await tempClient.downloadProfilePhoto(me, { isBig: false })
        if (photo && Buffer.isBuffer(photo) && photo.length > 0) {
          avatarUrl = `data:image/jpeg;base64,${photo.toString('base64')}`
        }
        await tempClient.disconnect().catch(() => {})
        return { displayName, avatarUrl }
      } catch (e) {
        console.warn('[TelegramMirrorService] Failed to fetch profile via temp client:', e)
        return {}
      }
    }

    try {
      const me: any = await this.client.getMe()
      const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || account.displayName
      let avatarUrl: string | undefined = undefined
      const photo = await this.client.downloadProfilePhoto(me, { isBig: false })
      if (photo && Buffer.isBuffer(photo) && photo.length > 0) {
        avatarUrl = `data:image/jpeg;base64,${photo.toString('base64')}`
      }
      return { displayName, avatarUrl }
    } catch (e) {
      console.warn('[TelegramMirrorService] Failed to fetch profile:', e)
      return {}
    }
  }

  private emitLog(log: MirrorLogItem): void {
    appStore.addLog(log)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:log-added', log)
        }
      } catch (e) {
        // ignore
      }
    })
  }

  public notifyStatusChange(): void {
    const status = this.getStatus()
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:status-changed', status)
        }
      } catch (e) {
        // ignore
      }
    })
  }
}

export const telegramMirrorService = new TelegramMirrorService()
