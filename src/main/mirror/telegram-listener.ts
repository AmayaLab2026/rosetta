import { TelegramClient, Api } from 'telegram'
import { computeCheck } from 'telegram/Password'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import { DeletedMessage } from 'telegram/events/DeletedMessage'
import { BrowserWindow } from 'electron'
import { appStore } from '../storage/store'
import { twitterDriver } from '../drivers/twitter'
import { ContentPipeline } from './pipeline'
import { Account, MirrorLogItem, TelegramAuthCodeSubmit, TelegramAuthRequest } from '../../shared/types'

export class TelegramMirrorService {
  private client: TelegramClient | null = null
  private isRunning: boolean = false
  private authClient: TelegramClient | null = null

  public getStatus() {
    const rules = appStore.getRules().filter((r) => r.enabled)
    return {
      running: this.isRunning,
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
   * Handle incoming message event from Telegram
   */
  private async handleIncomingMessage(event: any): Promise<void> {
    const message = event.message
    if (!message || (!message.message && !message.media)) return

    const chat = await message.getChat()
    const rawText = message.message || ''

    const chatUsername = chat?.username ? `@${chat.username}` : ''
    const chatId = chat?.id?.toString() || ''
    const chatTitle = chat?.title || chatUsername || 'Channel'
    const channelAttributionHandle = chatUsername || chatTitle
    const messageDate = message.date ? new Date(message.date * 1000) : new Date()

    // Download media if message has photo/document
    const mediaBuffers: Buffer[] = []
    if (message.media && this.client) {
      try {
        const buf = await this.client.downloadMedia(message, {})
        if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
          mediaBuffers.push(buf)
        }
      } catch (err) {
        console.warn('[Mirror] Failed to download media from Telegram:', err)
      }
    }

    // Find all matching enabled rules
    const rules = appStore.getRules().filter((r) => {
      if (!r.enabled) return false
      const source = r.sourceChannel.username?.toLowerCase().replace(/^@/, '')
      const incoming = (chat?.username || '').toLowerCase().replace(/^@/, '')
      return source === incoming || r.sourceChannel.id === chatId
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
          originalText: rawText || '(Media Message)',
          processedText: '',
          mediaCount: 0,
          status: 'failed',
          errorMessage: 'Target account not found'
        })
        continue
      }

      // Process content through pipeline with attribution footer (RT:@xxx or 来自:@xxx 西元xxx)
      const { text: processedText, shouldDrop } = ContentPipeline.process(
        rawText,
        rule.filters,
        channelAttributionHandle,
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
        // Upload media attachments to Twitter if enabled
        const mediaIds: string[] = []
        if (rule.filters.forwardMedia !== false && mediaBuffers.length > 0) {
          for (const buf of mediaBuffers) {
            try {
              const upRes = await twitterDriver.uploadMedia(targetAccount, buf)
              if (upRes.success && upRes.mediaId) {
                mediaIds.push(upRes.mediaId)
              }
            } catch (err) {
              console.warn('[Mirror] Failed to upload media to Twitter:', err)
            }
          }
        }

        const tweetContent = processedText || ContentPipeline.formatAttribution(
          channelAttributionHandle,
          rule.filters.attributionStyle || 'RT',
          messageDate
        )

        const chunks = rule.filters.autoSplitThread
          ? ContentPipeline.splitIntoThreadChunks(tweetContent)
          : [tweetContent]

        let publishRes
        if (chunks.length > 1) {
          publishRes = await twitterDriver.postThread(targetAccount, chunks, mediaIds)
        } else {
          publishRes = await twitterDriver.postTweet(targetAccount, chunks[0], undefined, mediaIds)
        }

        // Update rule stats
        rule.stats.totalReceived += 1
        if (publishRes.success) {
          rule.stats.totalForwarded += 1
          rule.stats.lastMirroredAt = new Date().toISOString()

          // Track mapping for automatic synchronized deletion
          const targetTweetIds = publishRes.tweetIds || (publishRes.tweetId ? [publishRes.tweetId] : [])
          if (targetTweetIds.length > 0) {
            appStore.saveMirroredPost({
              id: `mp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              ruleId: rule.id,
              telegramChannelId: chatId,
              telegramChannelUsername: chatUsername,
              telegramMessageId: message.id,
              targetPlatform: 'twitter',
              targetAccountId: targetAccount.id,
              targetTweetIds,
              createdAt: new Date().toISOString()
            })
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
          originalText: rawText || '(Media Message)',
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
