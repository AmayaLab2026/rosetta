import React, { useState, useEffect } from 'react'
import {
  Sliders,
  FolderOpen,
  Trash2,
  CheckCircle2,
  Power,
  Layers,
  Minimize2,
  ShieldCheck,
  Code2,
  ExternalLink,
  Info
} from 'lucide-react'
import { useI18n } from '../i18n'
import { AppSettings, Account } from '../../../shared/types'

interface SettingsViewProps {
  engineRunning: boolean
  accounts: Account[]
}

export const SettingsView: React.FC<SettingsViewProps> = ({ engineRunning, accounts }) => {
  const { t } = useI18n()
  const st = (t as any).settings || {}

  const [settings, setSettings] = useState<AppSettings>({
    autoStartEngineOnLaunch: true,
    minimizeToTray: true,
    openAtLogin: false,
    startMinimized: false
  })
  const [loading, setLoading] = useState(true)
  const [saveToast, setSaveToast] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  const loadSettings = async () => {
    try {
      if (!window.rosetta) return
      const [storedSettings, loginItem] = await Promise.all([
        window.rosetta.getSettings(),
        window.rosetta.getLoginItemSettings().catch(() => ({ openAtLogin: false }))
      ])
      setSettings({
        ...storedSettings,
        openAtLogin: loginItem.openAtLogin ?? storedSettings.openAtLogin ?? false
      })
    } catch (e) {
      console.error('[Settings] Failed to load settings:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const updateSetting = async (key: keyof AppSettings, value: any) => {
    const updated = { ...settings, [key]: value }
    setSettings(updated)

    try {
      if (key === 'openAtLogin' || key === 'startMinimized') {
        await window.rosetta.setLoginItemSettings({
          openAtLogin: key === 'openAtLogin' ? value : !!updated.openAtLogin,
          openAsHidden: key === 'startMinimized' ? value : !!updated.startMinimized
        })
      }
      await window.rosetta.saveSettings({ [key]: value })

      setSaveToast(true)
      setTimeout(() => setSaveToast(false), 2000)
    } catch (err) {
      console.error('[Settings] Save error:', err)
    }
  }

  const handleOpenDataDir = async () => {
    try {
      await window.rosetta.openDataDirectory()
    } catch (e) {
      console.error('[Settings] Open data dir failed:', e)
    }
  }

  const handleClearLogs = async () => {
    const confirmed = window.confirm(st.clearLogsConfirm || '确定要清空所有历史流水日志吗？此操作无法撤销。')
    if (!confirmed) return
    setClearingLogs(true)
    try {
      await window.rosetta.clearLogs()
      setSaveToast(true)
      setTimeout(() => setSaveToast(false), 2000)
    } catch (e) {
      console.error('[Settings] Clear logs failed:', e)
    } finally {
      setClearingLogs(false)
    }
  }

  const tgAccount = accounts.find((a) => a.platform === 'telegram')

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Top Header */}
      <div className="px-8 py-5 border-b border-surface-border bg-surface-card/40 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-serif font-bold text-foreground flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-brand" />
            {st.title || '系统设置'}
          </h1>
          <p className="text-xs text-gray-500 font-sans mt-0.5">
            {st.desc || '管理开机自启、托盘行为、监听引擎以及本地数据存储'}
          </p>
        </div>

        {saveToast && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded-full font-mono animate-fade-in shadow-xs">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {st.saveSuccess || '设置已保存'}
          </div>
        )}
      </div>

      {/* Main Content Form */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 max-w-4xl">
        {/* Startup & Tray Section */}
        <section className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-surface-border/60 pb-3 flex items-center gap-2">
            <Minimize2 className="w-4 h-4 text-brand" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {st.startupSection || '启动与托盘'}
              </h2>
              <p className="text-[11px] text-gray-500">
                {st.startupDesc || '系统集成与后台托盘驻留行为'}
              </p>
            </div>
          </div>

          <div className="space-y-3.5 pt-1">
            {/* Open at login */}
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <div className="text-xs font-medium text-foreground">
                  {st.openAtLogin || '开机自动启动'}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {st.openAtLoginSub || '在登录操作系统时自动在后台启动 Rosetta'}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={!!settings.openAtLogin}
                  onChange={(e) => updateSetting('openAtLogin', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand" />
              </label>
            </div>

            {/* Minimize to Tray */}
            <div className="flex items-center justify-between border-t border-surface-border/40 pt-3">
              <div className="pr-4">
                <div className="text-xs font-medium text-foreground">
                  {st.minimizeToTray || '关闭窗口时最小化到托盘'}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {st.minimizeToTraySub || '点击窗口关闭按钮 (X) 时隐藏至系统托盘，不中断后台镜像转发'}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.minimizeToTray !== false}
                  onChange={(e) => updateSetting('minimizeToTray', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand" />
              </label>
            </div>

            {/* Start Minimized */}
            <div className="flex items-center justify-between border-t border-surface-border/40 pt-3">
              <div className="pr-4">
                <div className="text-xs font-medium text-foreground">
                  {st.startMinimized || '静默后台启动'}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {st.startMinimizedSub || '随开机启动时不弹出主窗口，直接常驻托盘并运行'}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={!!settings.startMinimized}
                  onChange={(e) => updateSetting('startMinimized', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand" />
              </label>
            </div>
          </div>
        </section>

        {/* Engine Section */}
        <section className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-surface-border/60 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Power className="w-4 h-4 text-brand" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {st.engineSection || '镜像监听引擎'}
                </h2>
                <p className="text-[11px] text-gray-500">
                  {st.engineDesc || '自动化监听与投递调度设置'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border">
              <div
                className={`w-2 h-2 rounded-full ${
                  engineRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
                }`}
              />
              <span className={engineRunning ? 'text-emerald-700 font-medium' : 'text-gray-500'}>
                {engineRunning
                  ? st.engineRunning || '引擎当前正在监听中'
                  : st.engineStopped || '引擎当前已停止'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="pr-4">
              <div className="text-xs font-medium text-foreground">
                {st.autoStart || '随软件启动自动开启监听'}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {st.autoStartSub || '启动 Rosetta 时自动建立 Telegram MTProto 监听信道'}
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.autoStartEngineOnLaunch !== false}
                onChange={(e) => updateSetting('autoStartEngineOnLaunch', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand" />
            </label>
          </div>
        </section>

        {/* Telegram Credentials Review */}
        <section className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-surface-border/60 pb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {st.credentialsSection || 'Telegram 凭据与安全'}
              </h2>
              <p className="text-[11px] text-gray-500">
                {st.credentialsDesc || '已保存的 MTProto 身份凭据 (保存在本地配置)'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs font-mono">
            <div className="bg-surface-muted/50 border border-surface-border/70 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 font-sans uppercase">API ID</div>
              <div className="text-foreground font-semibold mt-1">
                {settings.telegramApiId || (tgAccount?.config as any)?.apiId || '未配置'}
              </div>
            </div>

            <div className="bg-surface-muted/50 border border-surface-border/70 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 font-sans uppercase">API Hash</div>
              <div className="text-foreground font-semibold mt-1">
                {settings.telegramApiHash
                  ? `${settings.telegramApiHash.substring(0, 4)}••••••••`
                  : '未配置'}
              </div>
            </div>

            <div className="bg-surface-muted/50 border border-surface-border/70 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 font-sans uppercase">关联手机号</div>
              <div className="text-foreground font-semibold mt-1">
                {settings.telegramPhone || tgAccount?.displayName || '未配置'}
              </div>
            </div>
          </div>
        </section>

        {/* Storage & Maintenance */}
        <section className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-surface-border/60 pb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-brand" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {st.storageSection || '存储与日志管理'}
              </h2>
              <p className="text-[11px] text-gray-500">
                {st.storageDesc || 'Rosetta 本地数据库、历史记录及缓存管理'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={handleOpenDataDir}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-surface hover:bg-surface-hover border border-surface-border text-foreground text-xs font-medium rounded-lg transition-colors shadow-2xs"
            >
              <FolderOpen className="w-4 h-4 text-brand" />
              {st.openDataDir || '打开本地数据目录'}
            </button>

            <button
              onClick={handleClearLogs}
              disabled={clearingLogs}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-medium rounded-lg transition-colors shadow-2xs disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              {clearingLogs ? '正在清理...' : st.clearLogs || '清空所有流水日志'}
            </button>
          </div>
        </section>

        {/* About Rosetta */}
        <section className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-surface-border/60 pb-3 flex items-center gap-2">
            <Info className="w-4 h-4 text-brand" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {st.aboutSection || '关于 Rosetta'}
              </h2>
              <p className="text-[11px] text-gray-500">
                Desktop Multi-channel Social Dispatcher & TG Mirror Workstation
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="space-y-1 text-xs">
              <div className="text-foreground font-semibold flex items-center gap-2">
                <span>Rosetta</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">
                  v0.1.0-alpha
                </span>
              </div>
              <div className="text-[11px] text-gray-500 font-sans">
                Electron 31 • React 18 • Vite 5 • GramJS MTProto • Tailwind CSS
              </div>
            </div>

            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-foreground hover:bg-surface-hover rounded-md border border-surface-border transition-colors"
            >
              <Code2 className="w-3.5 h-3.5 text-brand" />
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3 text-gray-400" />
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
