import { app, shell, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { telegramMirrorService } from './mirror/telegram-listener'
import { appStore } from './storage/store'
import { terminalLogger } from './storage/terminal-logger'
import { prewarmTwitterTransaction } from './drivers/twitter-transaction'
import { telegramBotInteractiveService } from './drivers/telegram-bot-interactive'
import { telegramBotDriver } from './drivers/telegram-bot'
export { twitterDriver } from './drivers/twitter'

// Initialize real-time terminal logger to intercept all system console logs
terminalLogger.init()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createTray(): void {
  if (tray) return
  const iconPath = join(__dirname, '../../resources/icon.png')
  if (!existsSync(iconPath)) return

  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('Rosetta — 社交同步与电报镜像中枢')

  const buildContextMenu = () => {
    const isEngineRunning = telegramMirrorService.getStatus().running
    const settings = appStore.getSettings()

    return Menu.buildFromTemplate([
      {
        label: '打开主窗口 (Show Window)',
        click: () => {
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      {
        label: `监听状态: ${isEngineRunning ? '● 正在运行 (Running)' : '○ 已停止 (Stopped)'}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '开机自动启动 (Launch on Boot)',
        type: 'checkbox',
        checked: !!settings.openAtLogin,
        click: (item) => {
          const checked = item.checked
          try {
            app.setLoginItemSettings({
              openAtLogin: checked,
              openAsHidden: !!settings.startMinimized,
              path: process.execPath,
              args: settings.startMinimized ? ['--hidden'] : []
            })
          } catch (e) {
            console.warn('[Tray] Failed to set login item settings:', e)
          }
          appStore.updateSettings({ openAtLogin: checked })
        }
      },
      {
        label: '关闭时最小化到托盘 (Close to Tray)',
        type: 'checkbox',
        checked: settings.minimizeToTray !== false,
        click: (item) => {
          appStore.updateSettings({ minimizeToTray: item.checked })
        }
      },
      { type: 'separator' },
      {
        label: '退出 Rosetta (Quit)',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  }

  tray.setContextMenu(buildContextMenu())

  // Refresh context menu on right click to reflect real-time engine state
  tray.on('right-click', () => {
    tray?.setContextMenu(buildContextMenu())
  })

  // Click to toggle or show window
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        mainWindow.hide()
      } else {
        mainWindow.focus()
      }
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  tray.on('double-click', () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
  })
}

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FAF9F5',
    titleBarStyle: 'hiddenInset',
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  const isHiddenLaunch =
    process.argv.includes('--hidden') ||
    (appStore.getSettings().startMinimized && app.getLoginItemSettings().wasOpenedAsHidden)

  mainWindow.on('ready-to-show', () => {
    if (!isHiddenLaunch) {
      mainWindow?.show()
    }
  })

  // Close to tray behavior
  mainWindow.on('close', (event) => {
    const settings = appStore.getSettings()
    if (!isQuitting && settings.minimizeToTray !== false) {
      event.preventDefault()
      mainWindow?.hide()
      return false
    }
    return true
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  createWindow()
  createTray()

  // Auto-start Telegram mirror engine on launch if enabled and configured
  try {
    const settings = appStore.getSettings()
    if (settings.autoStartEngineOnLaunch !== false) {
      const tgAccount = appStore.getAccounts().find((a) => a.platform === 'telegram' && a.status === 'active')
      if (tgAccount) {
        console.log('[Rosetta] Auto-starting Telegram mirror listener on app launch...')
        telegramMirrorService.start().catch((err) => {
          console.warn('[Rosetta] Auto-start engine failed:', err)
        })
      }
    }
  } catch (e) {
    console.warn('[Rosetta] Error checking auto-start:', e)
  }

  // Auto-refresh profiles & avatars for active accounts in background
  try {
    const twAccount = appStore.getAccounts().find((a) => a.platform === 'twitter' && a.status === 'active')
    if (twAccount) {
      twitterDriver.fetchUserProfile(twAccount).then((profile) => {
        if (profile.avatarUrl || profile.displayName) {
          if (profile.avatarUrl) twAccount.avatarUrl = profile.avatarUrl
          if (profile.displayName) twAccount.displayName = profile.displayName
          appStore.saveAccount(twAccount)
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('accounts:updated', twAccount)
            }
          })
        }
      }).catch((err) => console.warn('[Rosetta] Auto-fetch Twitter profile failed:', err))
    }
  } catch (e) {
    console.warn('[Rosetta] Error refreshing accounts:', e)
  }

  // Auto-start interactive Telegram Bot polling for user-to-bot chat posting
  try {
    telegramBotInteractiveService.start().catch((err) => {
      console.warn('[Rosetta] Failed to start interactive bot service on launch:', err)
    })
  } catch (e) {
    console.warn('[Rosetta] Error starting interactive bot:', e)
  }

  // Auto-sync real Telegram Bot identity & avatar from Telegram API
  try {
    const settings = appStore.getSettings()
    if (settings.defaultBotToken) {
      telegramBotDriver.verifyBotToken(settings.defaultBotToken).then((botInfo) => {
        if (botInfo.valid) {
          const accounts = appStore.getAccounts()
          let botAcc = accounts.find((a) => a.platform === 'telegram')
          if (!botAcc) {
            botAcc = {
              id: `tg_bot_${Date.now()}`,
              platform: 'telegram',
              username: botInfo.username ? `@${botInfo.username}` : '@bot',
              displayName: botInfo.botName || 'Rosetta Bot',
              avatarUrl: botInfo.avatarUrl,
              status: 'active',
              lastChecked: new Date().toISOString(),
              credentials: {
                botToken: settings.defaultBotToken,
                isBot: true
              }
            }
          } else {
            botAcc.displayName = botInfo.botName || botAcc.displayName
            botAcc.username = botInfo.username ? `@${botInfo.username}` : botAcc.username
            if (botInfo.avatarUrl) botAcc.avatarUrl = botInfo.avatarUrl
            botAcc.status = 'active'
            botAcc.lastChecked = new Date().toISOString()
            botAcc.credentials.botToken = settings.defaultBotToken
            botAcc.credentials.isBot = true
          }
          appStore.saveAccount(botAcc)
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('accounts:updated', botAcc)
            }
          })
        }
      }).catch((e) => console.warn('[Rosetta] Auto-sync Telegram bot profile failed:', e))
    }
  } catch (e) {
    console.warn('[Rosetta] Error syncing bot profile:', e)
  }

  // Pre-warm Twitter client transaction ID in background for zero-latency post signing
  prewarmTwitterTransaction().catch(() => {})
  setInterval(() => {
    prewarmTwitterTransaction().catch(() => {})
  }, 8 * 60 * 1000)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  telegramBotInteractiveService.stop()
  appStore.flushSync()
})

app.on('window-all-closed', () => {
  const settings = appStore.getSettings()
  if (isQuitting || settings.minimizeToTray === false) {
    telegramMirrorService.stop()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  }
})
