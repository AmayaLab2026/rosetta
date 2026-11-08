import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
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
      throw new Error('No active Telegram auth session. Please request code first.')
    }

    await this.authClient.signInUser(
      {
        apiId: authInfo.apiId,
        apiHash: authInfo.apiHash
      },
      {
        phoneNumber: submit.phoneNumber,
        phoneCodeHash: submit.phoneCodeHash,
        phoneCode: submit.code,
        password: submit.password ? async () => submit.password! : undefined
      }
    )

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
    if (!message || !message.message) return

    const chat = await message.getChat()
    const rawText = message.message || ''

    const chatUsername = chat?.username ? `@${chat.username}` : ''
    const chatId = chat?.id?.toString() || ''
    const chatTitle = chat?.title || chatUsername || 'Channel'

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
          originalText: rawText,
          processedText: '',
          mediaCount: 0,
          status: 'failed',
          errorMessage: 'Target account not found'
        })
        continue
      }

      // Process content through pipeline
      const { text: processedText, shouldDrop } = ContentPipeline.process(rawText, rule.filters)

      if (shouldDrop || !processedText) {
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: rule.targetAccount.platform,
          originalText: rawText,
          processedText: '(Filtered by content rules)',
          mediaCount: 0,
          status: 'filtered'
        })
        continue
      }

      // Dispatch to Twitter/X
      if (rule.targetAccount.platform === 'twitter') {
        const chunks = rule.filters.autoSplitThread
          ? ContentPipeline.splitIntoThreadChunks(processedText)
          : [processedText]

        let publishRes
        if (chunks.length > 1) {
          publishRes = await twitterDriver.postThread(targetAccount, chunks)
        } else {
          publishRes = await twitterDriver.postTweet(targetAccount, chunks[0])
        }

        // Update rule stats
        rule.stats.totalReceived += 1
        if (publishRes.success) {
          rule.stats.totalForwarded += 1
          rule.stats.lastMirroredAt = new Date().toISOString()
        }
        appStore.saveRule(rule)

        // Record log
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: 'twitter',
          originalText: rawText,
          processedText,
          mediaCount: 0,
          status: publishRes.success ? 'success' : 'failed',
          errorMessage: publishRes.error,
          targetUrl: publishRes.url
        })
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
