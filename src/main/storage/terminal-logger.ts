import { BrowserWindow } from 'electron'
import { TerminalLogItem } from '../../shared/types'
import { format } from 'util'

class TerminalLogger {
  private logs: TerminalLogItem[] = []
  private readonly maxLogs = 1000
  private isHooked = false

  public init(): void {
    if (this.isHooked) return
    this.isHooked = true

    const originalLog = console.log
    const originalInfo = console.info
    const originalWarn = console.warn
    const originalError = console.error

    const capture = (level: 'info' | 'warn' | 'error' | 'debug', args: any[]) => {
      const message = format(...args)
      const item: TerminalLogItem = {
        id: `tlog_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        level,
        message
      }

      this.logs.push(item)
      if (this.logs.length > this.maxLogs) {
        this.logs.shift()
      }

      // Broadcast to all windows
      BrowserWindow.getAllWindows().forEach((win) => {
        try {
          if (!win.isDestroyed() && win.webContents) {
            win.webContents.send('terminal:log-added', item)
          }
        } catch {
          // ignore
        }
      })
    }

    console.log = (...args: any[]) => {
      originalLog.apply(console, args)
      capture('info', args)
    }

    console.info = (...args: any[]) => {
      originalInfo.apply(console, args)
      capture('info', args)
    }

    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args)
      capture('warn', args)
    }

    console.error = (...args: any[]) => {
      originalError.apply(console, args)
      capture('error', args)
    }
  }

  public getLogs(): TerminalLogItem[] {
    return [...this.logs]
  }

  public clearLogs(): void {
    this.logs = []
    const clearNotice: TerminalLogItem = {
      id: `tlog_${Date.now()}`,
      timestamp: new Date().toISOString(),
      level: 'info',
      message: '[Rosetta] 终端日志已清空 (Terminal logs cleared)'
    }
    this.logs.push(clearNotice)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('terminal:log-added', clearNotice)
        }
      } catch {
        // ignore
      }
    })
  }
}

export const terminalLogger = new TerminalLogger()
