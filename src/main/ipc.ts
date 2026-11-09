import { ipcMain, app, shell } from 'electron'
import { appStore } from './storage/store'
import { terminalLogger } from './storage/terminal-logger'
import { twitterDriver } from './drivers/twitter'
import { telegramBotDriver } from './drivers/telegram-bot'
import { telegramBotInteractiveService } from './drivers/telegram-bot-interactive'
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
    const res = appStore.saveRule(rule)
    telegramMirrorService.notifyStatusChange()
    return res
  })

  ipcMain.handle('rules:delete', (_, id: string) => {
    const res = appStore.deleteRule(id)
    telegramMirrorService.notifyStatusChange()
    return res
  })

  ipcMain.handle('rules:toggle', (_, id: string, enabled: boolean) => {
    const rule = appStore.getRule(id)
    if (rule) {
      rule.enabled = enabled
      appStore.saveRule(rule)
      telegramMirrorService.notifyStatusChange()
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
      if (target.platform === 'telegram') {
        const startTime = Date.now()
        const logId = `log_composer_tg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
        const hasMedia = payload.mediaFiles && payload.mediaFiles.length > 0
        const settings = appStore.getSettings()
        const targetChatId = target.accountId || settings.defaultBotChatId || ''

        const logItem: MirrorLogItem = {
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: 'composer',
          sourceChannel: '统一发帖器 (Composer)',
          targetPlatform: 'telegram',
          originalText: payload.text || (hasMedia ? `[多媒体消息 - 共 ${payload.mediaFiles!.length} 项]` : '(Media Post)'),
          processedText: `正在通过 Bot API 推送至 Telegram (${targetChatId})...`,
          mediaCount: payload.mediaFiles?.length || 0,
          status: 'processing'
        }

        appStore.addLog(logItem)
        const { BrowserWindow } = require('electron')
        BrowserWindow.getAllWindows().forEach((win: any) => {
          if (!win.isDestroyed() && win.webContents) {
            win.webContents.send('mirror:log-added', logItem)
          }
        })

        try {
          const res = await telegramBotDriver.sendPost({
            chatId: targetChatId,
            text: payload.text,
            botToken: settings.defaultBotToken,
            mediaFiles: payload.mediaFiles
          })
          results.push({ platform: 'telegram', success: res.success, url: res.postUrl, error: res.error })

          const durationMs = Date.now() - startTime
          logItem.status = res.success ? 'success' : 'failed'
          logItem.processedText = res.success ? (payload.text || `已成功推送至电报频道 ${targetChatId}`) : (res.error || '电报发布失败')
          logItem.errorMessage = res.error
          logItem.targetUrl = res.postUrl
          logItem.durationMs = durationMs
          appStore.addLog(logItem)
          BrowserWindow.getAllWindows().forEach((win: any) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('mirror:log-added', logItem)
            }
          })
        } catch (tgErr: any) {
          const durationMs = Date.now() - startTime
          logItem.status = 'failed'
          logItem.errorMessage = tgErr?.message || '电报发布异常'
          logItem.durationMs = durationMs
          appStore.addLog(logItem)
          BrowserWindow.getAllWindows().forEach((win: any) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('mirror:log-added', logItem)
            }
          })
          results.push({ platform: 'telegram', success: false, error: tgErr?.message || '电报发布异常' })
        }
        continue
      }

      const account = appStore.getAccount(target.accountId)
      if (!account) {
        results.push({
          platform: target.platform,
          success: false,
          error: `Account ${target.accountId} not found`
        })
        continue
      }

      const startTime = Date.now()
      const logId = `log_composer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      const hasMedia = payload.mediaFiles && payload.mediaFiles.length > 0
      const logItem: MirrorLogItem = {
        id: logId,
        timestamp: new Date().toISOString(),
        ruleId: 'composer',
        sourceChannel: '统一发帖器 (Composer)',
        targetPlatform: target.platform,
        originalText: payload.text || (hasMedia ? `[多媒体消息 - 共 ${payload.mediaFiles!.length} 项]` : '(Media Post)'),
        processedText: hasMedia ? `正在并发上传 ${payload.mediaFiles!.length} 项附件并发布...` : '正在同步至 X / Twitter...',
        mediaCount: payload.mediaFiles?.length || 0,
        status: 'processing'
      }

      appStore.addLog(logItem)
      const { BrowserWindow } = require('electron')
      BrowserWindow.getAllWindows().forEach((win: any) => {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:log-added', logItem)
        }
      })

      if (target.platform === 'twitter') {
        try {
          // Upload attached media files (images & chunked videos) concurrently
          const mediaItems: Array<{ mediaId: string; isVideo?: boolean }> = []
          if (hasMedia) {
            const uploadPromises = payload.mediaFiles!.map((file) =>
              twitterDriver
                .uploadMedia(account, file.dataBase64, file.type)
                .then((res) =>
                  res.success && res.mediaId
                    ? { mediaId: res.mediaId, isVideo: res.isVideo ?? file.type.startsWith('video/') }
                    : null
                )
                .catch((err: any) => {
                  console.warn('[Composer] Failed to upload media:', err)
                  return null
                })
            )
            const uploaded = await Promise.all(uploadPromises)
            mediaItems.push(
              ...uploaded.filter((m): m is { mediaId: string; isVideo?: boolean } => Boolean(m))
            )
          }

          const res = await twitterDriver.publishPostWithMedia(
            account,
            payload.text,
            mediaItems,
            payload.options?.splitThreadIfLong !== false
          )
          results.push({ platform: 'twitter', ...res })

          // Update log with result and measured latency
          const durationMs = Date.now() - startTime
          logItem.status = res.success ? 'success' : 'failed'
          logItem.processedText = res.success ? payload.text : (payload.text || '发帖失败')
          logItem.errorMessage = res.error
          logItem.targetUrl = res.url
          logItem.durationMs = durationMs
          appStore.addLog(logItem)
          BrowserWindow.getAllWindows().forEach((win: any) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('mirror:log-added', logItem)
            }
          })
        } catch (postErr: any) {
          console.error('[Composer] Post dispatch error:', postErr)
          const durationMs = Date.now() - startTime
          logItem.status = 'failed'
          logItem.errorMessage = postErr?.message || String(postErr) || '发帖异常失败'
          logItem.durationMs = durationMs
          appStore.addLog(logItem)
          BrowserWindow.getAllWindows().forEach((win: any) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('mirror:log-added', logItem)
            }
          })
          results.push({
            platform: 'twitter',
            success: false,
            error: postErr?.message || '发帖异常失败'
          })
        }
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
    if (settings.defaultBotToken !== undefined || settings.defaultBotChatId !== undefined) {
      telegramBotInteractiveService.restart().catch(() => {})
    }
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

  // --- Terminal Console Logs ---
  ipcMain.handle('terminal:get', () => {
    return terminalLogger.getLogs()
  })

  ipcMain.handle('terminal:clear', () => {
    terminalLogger.clearLogs()
    return true
  })

  // --- Telegram Bot Operations ---
  ipcMain.handle('telegram:bot-send', (_, payload) => {
    return telegramBotDriver.sendPost(payload)
  })

  ipcMain.handle('telegram:bot-delete', (_, params) => {
    return telegramBotDriver.deletePost(params)
  })

  ipcMain.handle('telegram:bot-get-posts', () => {
    return appStore.getBotPosts()
  })

  ipcMain.handle('telegram:bot-clear-posts', () => {
    appStore.clearBotPosts()
    return true
  })

  ipcMain.handle('telegram:bot-verify-token', (_, token: string) => {
    return telegramBotDriver.verifyBotToken(token)
  })

  // --- Telegram Bot Interactive Polling ---
  ipcMain.handle('telegram:bot-interactive-status', () => {
    return telegramBotInteractiveService.getStatus()
  })

  ipcMain.handle('telegram:bot-interactive-toggle', async (_, start: boolean) => {
    if (start) return telegramBotInteractiveService.start()
    telegramBotInteractiveService.stop()
    return true
  })

  // --- Telegram Bot Pairing & Authorization ---
  ipcMain.handle('telegram:bot-get-pairing-info', () => {
    return {
      pairingCode: appStore.getBotPairingCode(),
      authorizedUserIds: appStore.getBotAuthorizedUserIds()
    }
  })

  ipcMain.handle('telegram:bot-reset-pairing-code', () => {
    return appStore.resetBotPairingCode()
  })

  ipcMain.handle('telegram:bot-revoke-user', (_, userId: number) => {
    return appStore.revokeBotAuthorizedUserId(userId)
  })

  // --- App Version Info (Dynamic) ---
  ipcMain.handle('app:get-version-info', () => {
    const pkg = require('../../package.json')
    return {
      version: pkg.version || '0.2.2',
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      v8: process.versions.v8
    }
  })

  // --- Recent Posts & Deletion Studio ---
  ipcMain.handle('telegram:get-channel-recent', async (_, params?: { channelId?: string; limit?: number }) => {
    const settings = appStore.getSettings()
    const targetChat = params?.channelId || settings.defaultBotChatId || ''
    return telegramMirrorService.getChannelRecentMessages(targetChat, params?.limit || 5)
  })

  ipcMain.handle('twitter:get-recent-tweets', async (_, params?: { accountId?: string; limit?: number }) => {
    const acc = params?.accountId
      ? appStore.getAccount(params.accountId)
      : appStore.getAccounts().find((a) => a.platform === 'twitter' && a.status === 'active')
    if (!acc) return []
    return twitterDriver.fetchRecentTweetsForDeletion(acc, params?.limit || 5)
  })

  ipcMain.handle('twitter:delete-tweet', async (_, params: { accountId?: string; tweetId: string }) => {
    const acc = params?.accountId
      ? appStore.getAccount(params.accountId)
      : appStore.getAccounts().find((a) => a.platform === 'twitter' && a.status === 'active')
    if (!acc) return { success: false, error: 'No active Twitter account found' }
    return twitterDriver.deleteTweet(acc, params.tweetId)
  })

  ipcMain.handle('telegram:delete-channel-post', async (_, params: { channelId?: string; messageId: number }) => {
    const settings = appStore.getSettings()
    const targetChat = params?.channelId || settings.defaultBotChatId || ''
    return telegramBotDriver.deletePost({
      chatId: targetChat,
      messageId: params.messageId
    })
  })
}
