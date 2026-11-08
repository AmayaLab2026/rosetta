import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { Account, MirrorRule, MirrorLogItem, MirroredPostRecord } from '../../shared/types'

interface StoreData {
  accounts: Account[]
  rules: MirrorRule[]
  logs: MirrorLogItem[]
  mirroredPosts: MirroredPostRecord[]
  settings: {
    telegramApiId?: number
    telegramApiHash?: string
    telegramPhone?: string
    autoStartEngineOnLaunch?: boolean
  }
}

const DEFAULT_STORE: StoreData = {
  accounts: [],
  rules: [],
  logs: [],
  mirroredPosts: [],
  settings: {
    autoStartEngineOnLaunch: true
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

  private persist(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (e) {
      console.error('[Store] Failed to write store:', e)
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
    this.persist()
    return account
  }

  public deleteAccount(id: string): boolean {
    const initialLen = this.data.accounts.length
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    this.persist()
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
    this.persist()
    return rule
  }

  public deleteRule(id: string): boolean {
    const initialLen = this.data.rules.length
    this.data.rules = this.data.rules.filter((r) => r.id !== id)
    this.persist()
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
    this.persist()
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

  // --- Settings ---
  public getSettings() {
    return this.data.settings
  }

  public updateSettings(settings: Partial<StoreData['settings']>) {
    this.data.settings = { ...this.data.settings, ...settings }
    this.persist()
  }
}

export const appStore = new AppStore()
