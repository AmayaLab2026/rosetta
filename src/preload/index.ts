import { contextBridge, ipcRenderer } from 'electron'
import { RosettaAPI } from '../shared/types'

const api: RosettaAPI = {
  // Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  saveAccount: (account) => ipcRenderer.invoke('accounts:save', account),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
  checkAccountHealth: (id) => ipcRenderer.invoke('accounts:check-health', id),
  openTwitterInteractiveLogin: () => ipcRenderer.invoke('twitter:interactive-login'),

  // Telegram Auth
  requestTelegramAuthCode: async (req) => {
    await ipcRenderer.invoke('telegram:prepare-auth', req)
    return ipcRenderer.invoke('telegram:request-code', req)
  },
  submitTelegramAuthCode: (req) => ipcRenderer.invoke('telegram:submit-code', req),

  // Mirror Rules
  getMirrorRules: () => ipcRenderer.invoke('rules:get'),
  saveMirrorRule: (rule) => ipcRenderer.invoke('rules:save', rule),
  deleteMirrorRule: (id) => ipcRenderer.invoke('rules:delete', id),
  toggleMirrorRule: (id, enabled) => ipcRenderer.invoke('rules:toggle', id, enabled),

  // Mirror Engine
  startMirrorEngine: () => ipcRenderer.invoke('mirror:start'),
  stopMirrorEngine: () => ipcRenderer.invoke('mirror:stop'),
  getMirrorEngineStatus: () => ipcRenderer.invoke('mirror:get-status'),

  // Composer
  sendUnifiedPost: (payload) => ipcRenderer.invoke('composer:send', payload),

  // Logs
  getLogs: (limit) => ipcRenderer.invoke('logs:get', limit),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  // Listeners
  onLogAdded: (callback) => {
    const handler = (_: any, log: any) => callback(log)
    ipcRenderer.on('mirror:log-added', handler)
    return () => ipcRenderer.removeListener('mirror:log-added', handler)
  },
  onStatusChanged: (callback) => {
    const handler = (_: any, status: any) => callback(status)
    ipcRenderer.on('mirror:status-changed', handler)
    return () => ipcRenderer.removeListener('mirror:status-changed', handler)
  }
}

try {
  contextBridge.exposeInMainWorld('rosetta', api)
} catch (error) {
  console.error('Failed to expose rosetta API via contextBridge:', error)
}
