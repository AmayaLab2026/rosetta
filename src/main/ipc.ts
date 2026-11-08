import { ipcMain } from 'electron'
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
    }

    return { status: acc.status }
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
  ipcMain.handle('telegram:request-code', async (_, req: TelegramAuthRequest) => {
    return telegramMirrorService.requestCode(req)
  })

  let pendingAuthReq: TelegramAuthRequest | null = null
  ipcMain.handle('telegram:prepare-auth', (_, req: TelegramAuthRequest) => {
    pendingAuthReq = req
    return true
  })

  ipcMain.handle('telegram:submit-code', async (_, submit: TelegramAuthCodeSubmit) => {
    if (!pendingAuthReq) {
      throw new Error('Telegram auth parameters expired. Please restart login.')
    }
    return telegramMirrorService.submitCode(pendingAuthReq, submit)
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

      if (target.platform === 'twitter') {
        const chunks = payload.options?.splitThreadIfLong
          ? ContentPipeline.splitIntoThreadChunks(payload.text)
          : [payload.text]

        if (chunks.length > 1) {
          const res = await twitterDriver.postThread(account, chunks)
          results.push({ platform: 'twitter', ...res })
        } else {
          const res = await twitterDriver.postTweet(account, chunks[0])
          results.push({ platform: 'twitter', ...res })
        }
      }
    }

    return {
      success: results.every((r) => r.success),
      results
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
