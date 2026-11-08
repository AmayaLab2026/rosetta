import { ipcMain, app, shell } from 'electron'
import { appStore } from './storage/store'
import { twitterDriver } from './drivers/twitter'
import { telegramMirrorService } from './mirror/telegram-listener'
import { ContentPipeline } from './mirror/pipeline'
import {
  Account,
  MirrorRule,
  TelegramAuthCodeSubmit,
  TelegramAuthRequest,
  UnifiedPostPayload
} from '../shared/types'

export function registerIpcHandlers(): void {
  // --- Accounts ---
  ipcMain.handle('accounts:get', () => {
    return appStore.getAccounts()
  })

  ipcMain.handle('accounts:save', (_, account: Account) => {
    return appStore.saveAccount(account)
  })

  ipcMain.handle('accounts:delete', (_, id: string) => {
    return appStore.deleteAccount(id)
  })

  ipcMain.handle('accounts:check-health', async (_, id: string) => {
    const acc = appStore.getAccount(id)
    if (!acc) return { status: 'error', error: 'Account not found' }

    if (acc.platform === 'twitter') {
      const profile = await twitterDriver.fetchUserProfile(acc)
      if (profile.displayName || profile.avatarUrl) {
        acc.status = 'active'
        if (profile.displayName) acc.displayName = profile.displayName
        if (profile.avatarUrl) acc.avatarUrl = profile.avatarUrl
        acc.lastChecked = new Date().toISOString()
        appStore.saveAccount(acc)
        return { status: 'active' }
      }

      const res = await twitterDriver.verifySession(
        acc.credentials.authToken || '',
        acc.credentials.ct0 || ''
      )
      if (res.valid && res.user) {
        acc.status = 'active'
        acc.displayName = res.user.name
        acc.avatarUrl = res.user.avatarUrl
        acc.lastChecked = new Date().toISOString()
        appStore.saveAccount(acc)
        return { status: 'active' }
      } else {
        acc.status = 'expired'
        acc.lastChecked = new Date().toISOString()
        appStore.saveAccount(acc)
        return { status: 'expired', error: res.error }
      }
    } else if (acc.platform === 'telegram') {
      try {
        const profile = await telegramMirrorService.fetchUserProfile(acc)
        if (profile.displayName || profile.avatarUrl) {
          acc.status = 'active'
          if (profile.displayName) acc.displayName = profile.displayName
          if (profile.avatarUrl) acc.avatarUrl = profile.avatarUrl
          acc.lastChecked = new Date().toISOString()
          appStore.saveAccount(acc)
          return { status: 'active' }
        }
      } catch (e: any) {
        return { status: 'error', error: e.message }
      }
    }

    return { status: acc.status }
  })

  ipcMain.handle('accounts:refresh-profile', async (_, id: string) => {
    const acc = appStore.getAccount(id)
    if (!acc) throw new Error('Account not found')

    if (acc.platform === 'twitter') {
      const profile = await twitterDriver.fetchUserProfile(acc)
      if (profile.displayName) acc.displayName = profile.displayName
      if (profile.avatarUrl) acc.avatarUrl = profile.avatarUrl
      if (profile.username) acc.username = profile.username
      acc.lastChecked = new Date().toISOString()
      appStore.saveAccount(acc)
    } else if (acc.platform === 'telegram') {
      const profile = await telegramMirrorService.fetchUserProfile(acc)
      if (profile.displayName) acc.displayName = profile.displayName
      if (profile.avatarUrl) acc.avatarUrl = profile.avatarUrl
      acc.lastChecked = new Date().toISOString()
      appStore.saveAccount(acc)
    }

    return acc
  })

  ipcMain.handle('twitter:interactive-login', async () => {
    const res = await twitterDriver.interactiveLogin()
    if (res.success && res.account) {
      const fullAccount: Account = {
        id: `tw_${Date.now()}`,
        platform: 'twitter',
        username: res.account.username || '',
        displayName: res.account.displayName || res.account.username || 'X User',
        avatarUrl: res.account.avatarUrl,
        status: 'active',
        lastChecked: new Date().toISOString(),
        credentials: res.account.credentials || {}
      }
      appStore.saveAccount(fullAccount)
      return { success: true, account: fullAccount }
    }
    return { success: false, error: res.error }
  })

  // --- Telegram Auth ---
  let pendingAuthReq: TelegramAuthRequest | null = null

  ipcMain.handle('telegram:request-code', async (_, req: TelegramAuthRequest) => {
    pendingAuthReq = req
    // Remember credentials in settings
    appStore.updateSettings({
      telegramApiId: req.apiId,
      telegramApiHash: req.apiHash,
      telegramPhone: req.phoneNumber
    })
    return telegramMirrorService.requestCode(req)
  })

  ipcMain.handle('telegram:prepare-auth', (_, req: TelegramAuthRequest) => {
    pendingAuthReq = req
    return true
  })

  ipcMain.handle('telegram:submit-code', async (_, submit: TelegramAuthCodeSubmit) => {
    if (!pendingAuthReq) {
      throw new Error('Telegram auth parameters expired. Please restart login.')
    }
    const acc = await telegramMirrorService.submitCode(pendingAuthReq, submit)
    // Auto start mirror service on login
    telegramMirrorService.start().catch((err) => {
      console.warn('[Rosetta] Auto-start engine after login failed:', err)
    })
    return acc
  })

  // --- Rules ---
  ipcMain.handle('rules:get', () => {
    return appStore.getRules()
  })

  ipcMain.handle('rules:save', (_, rule: MirrorRule) => {
    return appStore.saveRule(rule)
  })

  ipcMain.handle('rules:delete', (_, id: string) => {
    return appStore.deleteRule(id)
  })

  ipcMain.handle('rules:toggle', (_, id: string, enabled: boolean) => {
    const rule = appStore.getRule(id)
    if (rule) {
      rule.enabled = enabled
      appStore.saveRule(rule)
      return true
    }
    return false
  })

  // --- Mirror Engine ---
  ipcMain.handle('mirror:start', async () => {
    return telegramMirrorService.start()
  })

  ipcMain.handle('mirror:stop', async () => {
    return telegramMirrorService.stop()
  })

  ipcMain.handle('mirror:get-status', () => {
    return telegramMirrorService.getStatus()
  })

  // --- Composer (Manual Post) ---
  ipcMain.handle('composer:send', async (_, payload: UnifiedPostPayload) => {
    const results: Array<{ platform: 'telegram' | 'twitter'; success: boolean; url?: string; error?: string }> = []

    for (const target of payload.targets) {
      const account = appStore.getAccount(target.accountId)
      if (!account) {
        results.push({
          platform: target.platform,
          success: false,
          error: `Account ${target.accountId} not found`
        })
        continue
      }

      const logId = `log_composer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      const logItem: MirrorLogItem = {
        id: logId,
        timestamp: new Date().toISOString(),
        ruleId: 'composer',
        sourceChannel: '统一发帖器 (Composer)',
        targetPlatform: target.platform,
        originalText: payload.text || (payload.mediaFiles?.length ? `[多媒体消息 - 共 ${payload.mediaFiles.length} 项]` : '(Media Post)'),
        processedText: '正在发布...',
        mediaCount: payload.mediaFiles?.length || 0,
        status: 'processing'
      }

      appStore.addLog(logItem)
      const { BrowserWindow } = require('electron')
      BrowserWindow.getAllWindows().forEach((win: any) => win.webContents.send('mirror:log-added', logItem))

      if (target.platform === 'twitter') {
        // Upload any attached media files
        const mediaIds: string[] = []
        if (payload.mediaFiles && payload.mediaFiles.length > 0) {
          for (const file of payload.mediaFiles) {
            try {
              const uploadRes = await twitterDriver.uploadMedia(account, file.dataBase64, file.type)
              if (uploadRes.success && uploadRes.mediaId) {
                mediaIds.push(uploadRes.mediaId)
              }
            } catch (err: any) {
              console.warn('[Composer] Failed to upload media:', err)
            }
          }
        }

        const res = await twitterDriver.publishPostWithMedia(
          account,
          payload.text,
          mediaIds,
          payload.options?.splitThreadIfLong !== false
        )
        results.push({ platform: 'twitter', ...res })

        // Update log with result
        logItem.status = res.success ? 'success' : 'failed'
        logItem.processedText = res.success ? payload.text : ''
        logItem.errorMessage = res.error
        logItem.targetUrl = res.url
        appStore.addLog(logItem)
        BrowserWindow.getAllWindows().forEach((win: any) => win.webContents.send('mirror:log-added', logItem))
      }
    }

    return {
      success: results.every((r) => r.success),
      results
    }
  })

  // --- Settings & OS Integration ---
  ipcMain.handle('settings:get', () => {
    return appStore.getSettings()
  })

  ipcMain.handle('settings:save', (_, settings) => {
    appStore.updateSettings(settings)
    return true
  })

  ipcMain.handle('app:open-data-dir', async () => {
    try {
      const dir = app.getPath('userData')
      await shell.openPath(dir)
      return true
    } catch (e) {
      console.error('[IPC] Failed to open data directory:', e)
      return false
    }
  })

  ipcMain.handle('app:destroy-credentials', async () => {
    try {
      // 1. Immediately stop Telegram listener
      await telegramMirrorService.stop()

      // 2. Clear all Electron session cookies and web storage
      try {
        const { session } = require('electron')
        await session.defaultSession.clearStorageData()
      } catch (e) {
        console.warn('[IPC] Failed to clear session data:', e)
      }

      // 3. Wipe accounts and credentials from store
      appStore.destroyCredentials()

      // 4. Notify all renderer windows
      const { BrowserWindow } = require('electron')
      BrowserWindow.getAllWindows().forEach((win: any) => {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('accounts:updated')
          win.webContents.send('mirror:status-changed', { running: false, engineRunning: false, activeRulesCount: 0 })
        }
      })

      return true
    } catch (e) {
      console.error('[IPC] Failed to destroy credentials:', e)
      return false
    }
  })

  ipcMain.handle('settings:get-login-item', () => {
    try {
      const loginSettings = app.getLoginItemSettings()
      return {
        openAtLogin: loginSettings.openAtLogin,
        openAsHidden: loginSettings.wasOpenedAsHidden
      }
    } catch (e) {
      console.warn('[IPC] Failed to query login item settings:', e)
      const stored = appStore.getSettings()
      return { openAtLogin: !!stored.openAtLogin, openAsHidden: !!stored.startMinimized }
    }
  })

  ipcMain.handle('settings:set-login-item', (_, options: { openAtLogin: boolean; openAsHidden?: boolean }) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: options.openAtLogin,
        openAsHidden: options.openAsHidden ?? false,
        path: process.execPath,
        args: options.openAsHidden ? ['--hidden'] : []
      })
      appStore.updateSettings({
        openAtLogin: options.openAtLogin,
        startMinimized: options.openAsHidden ?? false
      })
      const current = app.getLoginItemSettings()
      return { openAtLogin: current.openAtLogin }
    } catch (e) {
      console.warn('[IPC] Failed to set login item settings:', e)
      appStore.updateSettings({
        openAtLogin: options.openAtLogin,
        startMinimized: options.openAsHidden ?? false
      })
      return { openAtLogin: options.openAtLogin }
    }
  })

  // --- Logs ---
  ipcMain.handle('logs:get', (_, limit = 100) => {
    return appStore.getLogs(limit)
  })

  ipcMain.handle('logs:clear', () => {
    appStore.clearLogs()
    return true
  })
}
