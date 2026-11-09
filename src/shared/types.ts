export type PlatformType = 'telegram' | 'twitter'

export interface Account {
  id: string
  platform: PlatformType
  username: string
  displayName: string
  avatarUrl?: string
  status: 'active' | 'expired' | 'connecting' | 'error'
  lastChecked: string
  credentials: {
    // Twitter specific
    authToken?: string
    ct0?: string
    cookies?: Record<string, string>
    // Telegram specific
    apiId?: number
    apiHash?: string
    sessionString?: string
    phoneNumber?: string
    isBot?: boolean
    botToken?: string
  }
}

export interface MirrorFilterConfig {
  removeTelegramLinks: boolean // Strip t.me/xxx
  removeOtherLinks: boolean
  removeHashtags: boolean
  stripAdKeywords: string[] // List of spam words to filter out
  customReplacements: Array<{ from: string; to: string }>
  prefix?: string
  suffix?: string
  autoSplitThread: boolean // Split >280 char posts into Twitter Thread
  forwardMedia: boolean
  autoSyncDeletion?: boolean // Sync deletion when source Telegram message is deleted
  attributionStyle?: 'RT' | 'from' | 'none' // 'RT': RT:@channel 西元..., 'from': 来自:@channel 西元..., 'none'
}

export interface MirrorRule {
  id: string
  name: string
  enabled: boolean
  sourceChannel: {
    id?: string
    username: string // e.g. @tech_news or channel username/link
    title?: string
  }
  targetAccount: {
    platform: PlatformType
    accountId: string
    accountName?: string
  }
  filters: MirrorFilterConfig
  stats: {
    totalReceived: number
    totalForwarded: number
    lastMirroredAt?: string
  }
  createdAt: string
}

export interface MirrorLogItem {
  id: string
  timestamp: string
  ruleId: string
  sourceChannel: string
  targetPlatform: PlatformType
  originalText: string
  processedText: string
  mediaCount: number
  status: 'success' | 'failed' | 'filtered' | 'processing' | 'deleted'
  errorMessage?: string
  targetUrl?: string
  durationMs?: number
}

export interface TerminalLogItem {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

export interface TelegramBotPostItem {
  id: string
  messageId: number
  chatId: string
  chatTitle?: string
  text: string
  mediaType?: 'none' | 'photo' | 'video' | 'album'
  mediaCount: number
  sentAt: string
  status: 'sent' | 'deleted'
  postUrl?: string
}

export interface TelegramBotSendPayload {
  chatId: string
  text: string
  botToken?: string
  useMtproto?: boolean
  mediaFiles?: Array<{ dataBase64: string; name: string; type: string }>
}

export interface AppVersionInfo {
  version: string
  electron: string
  node: string
  chrome: string
  v8: string
}

export interface TelegramChannelPost {
  id: number
  date: string
  text: string
  hasMedia: boolean
  mediaType?: string
  url?: string
}

export interface TwitterPostItem {
  id: string
  createdAt: string
  text: string
  url: string
}

export interface MirroredPostRecord {
  id: string
  ruleId: string
  telegramChannelId: string
  telegramChannelUsername?: string
  telegramMessageId: number
  targetPlatform: PlatformType
  targetAccountId: string
  targetTweetIds: string[]
  createdAt: string
}

export interface UnifiedPostPayload {
  text: string
  mediaPaths?: string[]
  mediaFiles?: Array<{ dataBase64: string; name: string; type: string }>
  targets: Array<{
    platform: PlatformType
    accountId: string
  }>
  options?: {
    splitThreadIfLong?: boolean
  }
}

export interface AppSettings {
  autoStartEngineOnLaunch?: boolean
  openAtLogin?: boolean
  minimizeToTray?: boolean
  startMinimized?: boolean
  defaultBotToken?: string
  defaultBotChatId?: string
  botPairingCode?: string
  botAuthorizedUserIds?: number[]
}

export interface RosettaAPI {
  // Accounts
  getAccounts: () => Promise<Account[]>
  saveAccount: (account: Partial<Account> & { platform: PlatformType }) => Promise<Account>
  deleteAccount: (id: string) => Promise<boolean>
  checkAccountHealth: (id: string) => Promise<{ status: Account['status']; error?: string }>
  refreshAccountProfile: (id: string) => Promise<Account>
  openTwitterInteractiveLogin: () => Promise<{ success: boolean; account?: Account; error?: string }>

  // Mirror Rules
  getMirrorRules: () => Promise<MirrorRule[]>
  saveMirrorRule: (rule: Partial<MirrorRule>) => Promise<MirrorRule>
  deleteMirrorRule: (id: string) => Promise<boolean>
  toggleMirrorRule: (id: string, enabled: boolean) => Promise<boolean>
  
  // Mirror Engine
  startMirrorEngine: () => Promise<boolean>
  stopMirrorEngine: () => Promise<boolean>
  getMirrorEngineStatus: () => Promise<{ running: boolean; activeRulesCount: number }>

  // Composer
  sendUnifiedPost: (payload: UnifiedPostPayload) => Promise<{ success: boolean; results: Array<{ platform: PlatformType; success: boolean; url?: string; error?: string }> }>

  // Logs
  getLogs: (limit?: number) => Promise<MirrorLogItem[]>
  clearLogs: () => Promise<boolean>

  // Terminal Console Logs
  getTerminalLogs: () => Promise<TerminalLogItem[]>
  clearTerminalLogs: () => Promise<boolean>

  // Telegram Bot Operations
  sendTelegramBotPost: (payload: TelegramBotSendPayload) => Promise<{ success: boolean; messageId?: number; postUrl?: string; error?: string }>
  deleteTelegramBotPost: (params: { chatId: string; messageId: number; botToken?: string; useMtproto?: boolean }) => Promise<{ success: boolean; error?: string }>
  getTelegramBotPosts: () => Promise<TelegramBotPostItem[]>
  clearTelegramBotPosts: () => Promise<boolean>
  verifyTelegramBotToken: (token: string) => Promise<{ valid: boolean; botName?: string; username?: string; avatarUrl?: string; error?: string }>
  getTelegramBotInteractiveStatus: () => Promise<{ polling: boolean; botUsername: string | null; botFirstName: string | null }>
  toggleTelegramBotInteractive: (start: boolean) => Promise<boolean>
  getBotPairingInfo: () => Promise<{ pairingCode: string; authorizedUserIds: number[]; blockedUserIds: number[] }>
  resetBotPairingCode: () => Promise<string>
  revokeBotAuthorizedUser: (userId: number) => Promise<boolean>
  unblockBotUser: (userId: number) => Promise<boolean>

  // Dedicated Channel / Twitter Post Deletion Studio
  getTelegramRecentPosts: (params?: { channelId?: string; limit?: number }) => Promise<TelegramChannelPost[]>
  getTwitterRecentPosts: (params?: { accountId?: string; limit?: number }) => Promise<TwitterPostItem[]>
  deleteTwitterTweet: (params: { accountId?: string; tweetId: string }) => Promise<{ success: boolean; error?: string }>
  deleteTelegramChannelPost: (params: { channelId?: string; messageId: number }) => Promise<{ success: boolean; error?: string }>
  getAppVersionInfo: () => Promise<AppVersionInfo>

  // Settings & System
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: Partial<AppSettings>) => Promise<boolean>
  openDataDirectory: () => Promise<boolean>
  destroyCredentials: () => Promise<boolean>
  getLoginItemSettings: () => Promise<{ openAtLogin: boolean; openAsHidden?: boolean }>
  setLoginItemSettings: (settings: { openAtLogin: boolean; openAsHidden?: boolean }) => Promise<{ openAtLogin: boolean }>

  // Listeners
  onLogAdded: (callback: (log: MirrorLogItem) => void) => () => void
  onTerminalLogAdded: (callback: (log: TerminalLogItem) => void) => () => void
  onStatusChanged: (callback: (status: { engineRunning: boolean }) => void) => () => void
  onAccountsUpdated: (callback: (account: Account) => void) => () => void
}
