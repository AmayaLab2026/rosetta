import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { Account, MirrorRule, MirrorLogItem, MirroredPostRecord, AppSettings, TelegramBotPostItem } from '../../shared/types'

interface StoreData {
  accounts: Account[]
  rules: MirrorRule[]
  logs: MirrorLogItem[]
  mirroredPosts: MirroredPostRecord[]
  botPosts?: TelegramBotPostItem[]
  botBlockedUserIds?: number[]
  botFailedAttempts?: Record<string, number>
  settings: AppSettings
}

const DEFAULT_STORE: StoreData = {
  accounts: [],
  rules: [],
  logs: [],
  mirroredPosts: [],
  botPosts: [],
  botBlockedUserIds: [],
  botFailedAttempts: {},
  settings: {
    autoStartEngineOnLaunch: true,
    minimizeToTray: true,
    openAtLogin: false,
    startMinimized: false
  }
}

export class AppStore {
  private filePath: string
  private data: StoreData

  constructor() {
    let userDataDir: string
    try {
      userDataDir = app.getPath('userData')
    } catch {
      // In dev mode or before ready
      userDataDir = join(process.cwd(), '.rosetta-data')
    }

    if (!existsSync(userDataDir)) {
      mkdirSync(userDataDir, { recursive: true })
    }

    this.filePath = join(userDataDir, 'rosetta-store.json')
    this.data = this.load()
  }

  private load(): StoreData {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        return {
          ...DEFAULT_STORE,
          ...parsed,
          mirroredPosts: parsed.mirroredPosts || []
        }
      }
    } catch (e) {
      console.error('[Store] Failed to load store, using default:', e)
    }
    return { ...DEFAULT_STORE }
  }

  private saveTimeout: NodeJS.Timeout | null = null

  private persist(immediate = false): void {
    if (immediate) {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout)
        this.saveTimeout = null
      }
      try {
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
      } catch (e) {
        console.error('[Store] Failed to write store synchronously:', e)
      }
      return
    }

    // Debounced async write to avoid blocking event loop during rapid log updates
    if (this.saveTimeout) return
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null
      try {
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
      } catch (e) {
        console.error('[Store] Failed to write store asynchronously:', e)
      }
    }, 300)
  }

  public flushSync(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch {
      // ignore
    }
  }

  // --- Accounts ---
  public getAccounts(): Account[] {
    return this.data.accounts
  }

  public getAccount(id: string): Account | undefined {
    return this.data.accounts.find((a) => a.id === id)
  }

  public getAccountByPlatform(platform: string): Account | undefined {
    return this.data.accounts.find((a) => a.platform === platform && a.status === 'active')
  }

  public saveAccount(account: Account): Account {
    const idx = this.data.accounts.findIndex((a) => a.id === account.id)
    if (idx >= 0) {
      this.data.accounts[idx] = account
    } else {
      this.data.accounts.push(account)
    }
    this.persist(true)
    return account
  }

  public deleteAccount(id: string): boolean {
    const initialLen = this.data.accounts.length
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    this.persist(true)
    return this.data.accounts.length < initialLen
  }

  // --- Mirror Rules ---
  public getRules(): MirrorRule[] {
    return this.data.rules
  }

  public getRule(id: string): MirrorRule | undefined {
    return this.data.rules.find((r) => r.id === id)
  }

  public saveRule(rule: MirrorRule): MirrorRule {
    const idx = this.data.rules.findIndex((r) => r.id === rule.id)
    if (idx >= 0) {
      this.data.rules[idx] = rule
    } else {
      this.data.rules.push(rule)
    }
    this.persist(true)
    return rule
  }

  public deleteRule(id: string): boolean {
    const initialLen = this.data.rules.length
    this.data.rules = this.data.rules.filter((r) => r.id !== id)
    this.persist(true)
    return this.data.rules.length < initialLen
  }

  // --- Logs ---
  public getLogs(limit = 100): MirrorLogItem[] {
    return this.data.logs.slice(-limit).reverse()
  }

  public addLog(log: MirrorLogItem): void {
    const idx = this.data.logs.findIndex((l) => l.id === log.id)
    if (idx >= 0) {
      this.data.logs[idx] = log
    } else {
      this.data.logs.push(log)
    }
    // Keep max 500 logs in memory/disk
    if (this.data.logs.length > 500) {
      this.data.logs = this.data.logs.slice(-500)
    }
    this.persist()
  }

  public clearLogs(): void {
    this.data.logs = []
    this.persist(true)
  }

  // --- Mirrored Posts Mapping (for Auto-Delete) ---
  public getMirroredPosts(): MirroredPostRecord[] {
    return this.data.mirroredPosts || []
  }

  public saveMirroredPost(record: MirroredPostRecord): void {
    if (!this.data.mirroredPosts) this.data.mirroredPosts = []
    this.data.mirroredPosts.push(record)
    // Keep max 3,000 mappings
    if (this.data.mirroredPosts.length > 3000) {
      this.data.mirroredPosts = this.data.mirroredPosts.slice(-3000)
    }
    this.persist()
  }

  public findMirroredPostsByTelegram(channelId: string, messageId: number): MirroredPostRecord[] {
    if (!this.data.mirroredPosts) return []
    const normChannelId = channelId.replace(/^-100/, '').replace(/^@/, '').toLowerCase()
    return this.data.mirroredPosts.filter((m) => {
      const storedChannel = (m.telegramChannelId || '').replace(/^-100/, '').replace(/^@/, '').toLowerCase()
      const storedUsername = (m.telegramChannelUsername || '').replace(/^@/, '').toLowerCase()
      const channelMatches = !channelId || storedChannel === normChannelId || storedUsername === normChannelId
      return channelMatches && m.telegramMessageId === messageId
    })
  }

  public findMirroredPostsByMessageId(messageId: number): MirroredPostRecord[] {
    if (!this.data.mirroredPosts) return []
    return this.data.mirroredPosts.filter((m) => m.telegramMessageId === messageId)
  }

  public deleteMirroredPost(id: string): void {
    if (!this.data.mirroredPosts) return
    this.data.mirroredPosts = this.data.mirroredPosts.filter((m) => m.id !== id)
    this.persist()
  }

  // --- Telegram Bot Posts ---
  public getBotPosts(): TelegramBotPostItem[] {
    return (this.data.botPosts || []).slice(-200).reverse()
  }

  public saveBotPost(post: TelegramBotPostItem): void {
    if (!this.data.botPosts) this.data.botPosts = []
    const idx = this.data.botPosts.findIndex((p) => p.id === post.id)
    if (idx >= 0) {
      this.data.botPosts[idx] = post
    } else {
      this.data.botPosts.push(post)
    }
    if (this.data.botPosts.length > 500) {
      this.data.botPosts = this.data.botPosts.slice(-500)
    }
    this.persist()
  }

  public updateBotPostStatus(chatId: string, messageId: number, status: 'sent' | 'deleted'): void {
    if (!this.data.botPosts) return
    const normChat = chatId.replace(/^-100/, '').replace(/^@/, '').toLowerCase()
    let changed = false
    this.data.botPosts.forEach((p) => {
      const pChat = p.chatId.replace(/^-100/, '').replace(/^@/, '').toLowerCase()
      if ((pChat === normChat || !chatId) && p.messageId === messageId) {
        p.status = status
        changed = true
      }
    })
    if (changed) this.persist(true)
  }

  public clearBotPosts(): void {
    this.data.botPosts = []
    this.persist(true)
  }

  // --- Telegram Bot Pairing & Authorization ---
  public getBotPairingCode(): string {
    if (!this.data.settings.botPairingCode) {
      this.data.settings.botPairingCode = Math.floor(100000 + Math.random() * 900000).toString()
      this.persist(true)
    }
    return this.data.settings.botPairingCode
  }

  public resetBotPairingCode(): string {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    this.data.settings.botPairingCode = code
    this.persist(true)
    return code
  }

  public getBotAuthorizedUserIds(): number[] {
    return this.data.settings.botAuthorizedUserIds || []
  }

  public isBotUserAuthorized(userId: number): boolean {
    const list = this.data.settings.botAuthorizedUserIds || []
    return list.includes(userId)
  }

  public addBotAuthorizedUserId(userId: number): void {
    if (!this.data.settings.botAuthorizedUserIds) {
      this.data.settings.botAuthorizedUserIds = []
    }
    if (!this.data.settings.botAuthorizedUserIds.includes(userId)) {
      this.data.settings.botAuthorizedUserIds.push(userId)
      this.persist(true)
    }
  }

  public revokeBotAuthorizedUserId(userId: number): boolean {
    if (!this.data.settings.botAuthorizedUserIds) return false
    const initLen = this.data.settings.botAuthorizedUserIds.length
    this.data.settings.botAuthorizedUserIds = this.data.settings.botAuthorizedUserIds.filter((id) => id !== userId)
    if (this.data.settings.botAuthorizedUserIds.length < initLen) {
      this.persist(true)
      return true
    }
    return false
  }

  public isBotUserBlocked(userId: number): boolean {
    const blocked = this.data.botBlockedUserIds || []
    return blocked.includes(userId)
  }

  public getBotBlockedUserIds(): number[] {
    return this.data.botBlockedUserIds || []
  }

  public recordBotPairingFailure(userId: number): number {
    if (!this.data.botFailedAttempts) this.data.botFailedAttempts = {}
    const key = String(userId)
    const current = (this.data.botFailedAttempts[key] || 0) + 1
    this.data.botFailedAttempts[key] = current

    if (current >= 5) {
      if (!this.data.botBlockedUserIds) this.data.botBlockedUserIds = []
      if (!this.data.botBlockedUserIds.includes(userId)) {
        this.data.botBlockedUserIds.push(userId)
      }
    }
    this.persist(true)
    return current
  }

  public clearBotPairingAttempts(userId: number): void {
    if (this.data.botFailedAttempts) {
      delete this.data.botFailedAttempts[String(userId)]
      this.persist(true)
    }
  }

  public unblockBotUser(userId: number): boolean {
    if (!this.data.botBlockedUserIds) return false
    this.clearBotPairingAttempts(userId)
    const initLen = this.data.botBlockedUserIds.length
    this.data.botBlockedUserIds = this.data.botBlockedUserIds.filter((id) => id !== userId)
    if (this.data.botBlockedUserIds.length < initLen) {
      this.persist(true)
      return true
    }
    return false
  }

  // --- Settings ---
  public getSettings() {
    return this.data.settings
  }

  public updateSettings(settings: Partial<StoreData['settings']>) {
    this.data.settings = { ...this.data.settings, ...settings }
    this.persist(true)
  }

  // --- Security & Credential Destruction ---
  public destroyCredentials(): void {
    this.data.accounts = []
    this.data.settings.telegramApiId = undefined
    this.data.settings.telegramApiHash = undefined
    this.data.settings.telegramPhone = undefined
    this.persist(true)
  }
}

export const appStore = new AppStore()
