import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { telegramMirrorService } from './mirror/telegram-listener'
import { appStore } from './storage/store'
export { twitterDriver } from './drivers/twitter'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FAF9F5',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  createWindow()

  // Auto-start Telegram mirror engine on launch if enabled and configured
  try {
    const settings = appStore.getSettings()
    if (settings.autoStartEngineOnLaunch !== false) {
      const tgAccount = appStore.getAccounts().find((a) => a.platform === 'telegram' && a.status === 'active')
      const hasEnabledRules = appStore.getRules().some((r) => r.enabled)
      if (tgAccount && hasEnabledRules) {
        console.log('[Rosetta] Auto-starting Telegram mirror listener on app launch...')
        telegramMirrorService.start().catch((err) => {
          console.warn('[Rosetta] Auto-start engine failed:', err)
        })
      }
    }
  } catch (e) {
    console.warn('[Rosetta] Error checking auto-start:', e)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  telegramMirrorService.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
