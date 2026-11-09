import React, { useState, useEffect } from 'react'
import { Account } from '../../../shared/types'
import { CheckCircle2, AlertCircle, RefreshCw, Trash2, Globe, ExternalLink, Bot, KeyRound, Check } from 'lucide-react'
import { useI18n } from '../i18n'

interface AccountsManagerProps {
  accounts: Account[]
  onAccountUpdated: () => void
}

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  accounts,
  onAccountUpdated
}) => {
  const { t } = useI18n()

  // Twitter manual entry state
  const [showTwitterManual, setShowTwitterManual] = useState(false)
  const [twAuthToken, setTwAuthToken] = useState('')
  const [twCt0, setTwCt0] = useState('')
  const [twLoading, setTwLoading] = useState(false)

  // Telegram Bot Token state (pure Bot API)
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [tgLoading, setTgLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [savedSuccess, setSavedSuccess] = useState(false)

  useEffect(() => {
    window.rosetta.getSettings?.().then((settings) => {
      if (settings) {
        if (settings.defaultBotToken) setTgBotToken(settings.defaultBotToken)
        if (settings.defaultBotChatId) setTgChatId(settings.defaultBotChatId)
      }
    }).catch(() => {})
  }, [])

  // Auto-fetch avatar & real profile on mount
  useEffect(() => {
    accounts.forEach((acc) => {
      if (acc.platform === 'telegram') {
        window.rosetta.refreshAccountProfile?.(acc.id).then(() => {
          onAccountUpdated()
        }).catch(() => {})
      } else if (acc.status === 'active' && !acc.avatarUrl) {
        window.rosetta.refreshAccountProfile?.(acc.id).then(() => {
          onAccountUpdated()
        }).catch(() => {})
      }
    })
  }, [])

  const twitterAccount = accounts.find((a) => a.platform === 'twitter')
  const telegramBotAccount = accounts.find((a) => a.platform === 'telegram')

  // Interactive Twitter Login
  const handleTwitterInteractive = async () => {
    setTwLoading(true)
    setErrorMsg(null)
    try {
      const res = await window.rosetta.openTwitterInteractiveLogin()
      if (res.success) {
        onAccountUpdated()
      } else if (res.error) {
        setErrorMsg(res.error)
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed')
    } finally {
      setTwLoading(false)
    }
  }

  // Manual Twitter Token Save
  const handleTwitterManualSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!twAuthToken.trim() || !twCt0.trim()) return

    setTwLoading(true)
    setErrorMsg(null)
    try {
      const testAccount: Account = {
        id: `tw_${Date.now()}`,
        platform: 'twitter',
        username: 'detecting...',
        displayName: 'X Account',
        status: 'connecting',
        lastChecked: new Date().toISOString(),
        credentials: {
          authToken: twAuthToken.trim(),
          ct0: twCt0.trim()
        }
      }
      await window.rosetta.saveAccount(testAccount)
      const health = await window.rosetta.checkAccountHealth(testAccount.id)
      if (health.status === 'active') {
        setShowTwitterManual(false)
        setTwAuthToken('')
        setTwCt0('')
        onAccountUpdated()
      } else {
        setErrorMsg(health.error || 'Cookies verification failed')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save account')
    } finally {
      setTwLoading(false)
    }
  }

  // Telegram Bot Token Save & Verify
  const handleSaveTelegramBot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tgBotToken.trim()) return

    setTgLoading(true)
    setErrorMsg(null)
    setSavedSuccess(false)

    try {
      // 1. Verify token with official Telegram API
      const res = await window.rosetta.verifyTelegramBotToken(tgBotToken.trim())
      if (!res.valid) {
        setErrorMsg(res.error || t.bot.tokenInvalid)
        setTgLoading(false)
        return
      }

      // 2. Persist in settings
      await window.rosetta.saveSettings({
        defaultBotToken: tgBotToken.trim(),
        defaultBotChatId: tgChatId.trim() || undefined
      })

      // 3. Save as platform account with real bot avatar
      const existingTg = accounts.find((a) => a.platform === 'telegram')
      const botAccount: Account = {
        id: existingTg ? existingTg.id : `tg_bot_${Date.now()}`,
        platform: 'telegram',
        username: res.username ? `@${res.username}` : '@telegram_bot',
        displayName: res.botName || 'Telegram Bot',
        avatarUrl: res.avatarUrl,
        status: 'active',
        lastChecked: new Date().toISOString(),
        credentials: {
          botToken: tgBotToken.trim(),
          isBot: true
        }
      }
      await window.rosetta.saveAccount(botAccount)

      setSavedSuccess(true)
      setTimeout(() => setSavedSuccess(false), 2000)
      onAccountUpdated()
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to connect Telegram Bot')
    } finally {
      setTgLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (confirm('Disconnect this account?')) {
      await window.rosetta.deleteAccount(id)
      onAccountUpdated()
    }
  }

  const handleVerify = async (id: string) => {
    setRefreshingId(id)
    try {
      if (window.rosetta.refreshAccountProfile) {
        await window.rosetta.refreshAccountProfile(id)
      }
      await window.rosetta.checkAccountHealth(id)
      onAccountUpdated()
    } catch (e) {
      console.warn('Verify / refresh failed:', e)
    } finally {
      setRefreshingId(null)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <div>
        <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">
          {t.accounts.title}
        </h2>
        <p className="text-xs text-gray-500 font-mono">
          {t.accounts.desc}
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-800 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-800 hover:text-black">
            Dismiss
          </button>
        </div>
      )}

      {/* Twitter Section */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-surface-muted border border-surface-border flex items-center justify-center font-bold text-xs text-foreground">
              𝕏
            </div>
            <div>
              <h3 className="text-xs font-semibold text-foreground font-mono">{t.accounts.twitterTitle}</h3>
              <p className="text-[11px] text-gray-500 font-mono">{t.accounts.twitterDesc}</p>
            </div>
          </div>

          {twitterAccount && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleVerify(twitterAccount.id)}
                title={t.studio.viewTweet}
                disabled={refreshingId === twitterAccount.id}
                className="p-1.5 rounded-lg text-gray-600 hover:text-foreground hover:bg-surface-hover border border-surface-border transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === twitterAccount.id ? 'animate-spin text-brand' : ''}`} />
              </button>
              <button
                onClick={() => handleDelete(twitterAccount.id)}
                title="Disconnect"
                className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 border border-surface-border"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {twitterAccount ? (
          <div className="p-4 rounded-xl bg-surface-muted/60 border border-surface-border flex items-center justify-between shadow-2xs surface-hover-card">
            <div className="flex items-center gap-3">
              {twitterAccount.avatarUrl ? (
                <img
                  src={twitterAccount.avatarUrl}
                  alt={twitterAccount.username}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                  className="w-10 h-10 rounded-full border border-surface-border object-cover shadow-2xs"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand-subtle text-brand flex items-center justify-center font-bold text-sm border border-brand-border/60">
                  {twitterAccount.username[0]?.toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-foreground">{twitterAccount.displayName}</p>
                <p className="text-[11px] font-mono text-gray-500">@{twitterAccount.username}</p>
              </div>
            </div>

            <span
              className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border shadow-2xs flex items-center gap-1 font-medium ${
                twitterAccount.status === 'active'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-rose-50 text-rose-800 border-rose-300'
              }`}
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {twitterAccount.status === 'active' ? t.accounts.sessionActive : t.accounts.sessionExpired}
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={handleTwitterInteractive}
                disabled={twLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium shadow-glow-terracotta transition-all"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{twLoading ? t.accounts.openingBrowser : t.accounts.interactiveLogin}</span>
              </button>

              <button
                onClick={() => setShowTwitterManual(!showTwitterManual)}
                className="px-3 py-2 rounded-lg border border-surface-border text-gray-600 hover:text-foreground text-xs font-mono transition-colors bg-surface"
              >
                {showTwitterManual ? t.accounts.hideManual : t.accounts.manualToken}
              </button>
            </div>

            {showTwitterManual && (
              <form
                onSubmit={handleTwitterManualSave}
                className="p-3.5 rounded-lg bg-surface-muted/60 border border-surface-border space-y-3"
              >
                <div>
                  <label className="text-[11px] font-mono text-gray-600 block mb-1">
                    {t.accounts.authTokenLabel}
                  </label>
                  <input
                    type="password"
                    required
                    value={twAuthToken}
                    onChange={(e) => setTwAuthToken(e.target.value)}
                    placeholder="e.g. 841f3..."
                    className="w-full bg-surface border border-surface-border rounded px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono text-gray-600 block mb-1">
                    {t.accounts.ct0Label}
                  </label>
                  <input
                    type="password"
                    required
                    value={twCt0}
                    onChange={(e) => setTwCt0(e.target.value)}
                    placeholder="e.g. 5219ab..."
                    className="w-full bg-surface border border-surface-border rounded px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand"
                  />
                </div>

                <button
                  type="submit"
                  disabled={twLoading}
                  className="px-4 py-1.5 rounded bg-surface border border-surface-border hover:bg-surface-hover text-foreground text-xs font-mono shadow-sm"
                >
                  {t.accounts.saveVerifyCookies}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Telegram Section (Bot API) */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-telegram-subtle border border-telegram-border flex items-center justify-center font-bold text-xs text-telegram">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-foreground font-mono">Telegram 机器人 (Bot API)</h3>
              <p className="text-[11px] text-gray-500 font-mono">
                通过官方 HTTP Bot API 直连，免去繁琐手机验证码，用于接收私聊指令与频道发帖
              </p>
            </div>
          </div>

          {telegramBotAccount && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleVerify(telegramBotAccount.id)}
                title="Refresh Status"
                disabled={refreshingId === telegramBotAccount.id}
                className="p-1.5 rounded-lg text-gray-600 hover:text-foreground hover:bg-surface-hover border border-surface-border transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === telegramBotAccount.id ? 'animate-spin text-telegram' : ''}`} />
              </button>
              <button
                onClick={() => handleDelete(telegramBotAccount.id)}
                title="Disconnect"
                className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 border border-surface-border"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {telegramBotAccount ? (
          <div className="p-4 rounded-xl bg-surface-muted/60 border border-surface-border flex items-center justify-between shadow-2xs surface-hover-card">
            <div className="flex items-center gap-3">
              {telegramBotAccount.avatarUrl ? (
                <img
                  src={telegramBotAccount.avatarUrl}
                  alt={telegramBotAccount.username}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                  className="w-10 h-10 rounded-full border border-surface-border object-cover shrink-0 shadow-2xs"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-telegram-subtle border border-telegram-border/60 flex items-center justify-center font-bold text-xs text-telegram shadow-2xs font-mono">
                  [BOT]
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-foreground">{telegramBotAccount.displayName}</p>
                <p className="text-[11px] font-mono text-gray-500">{telegramBotAccount.username}</p>
              </div>
            </div>

            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>官方 Bot API 已就绪</span>
            </span>
          </div>
        ) : (
          <form onSubmit={handleSaveTelegramBot} className="space-y-3 font-mono text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-gray-600 block mb-1 font-semibold">
                  Telegram Bot Token (来自 @BotFather) *
                </label>
                <input
                  type="password"
                  required
                  value={tgBotToken}
                  onChange={(e) => setTgBotToken(e.target.value)}
                  placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRstuVWXyz"
                  className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand"
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-600 block mb-1 font-semibold">
                  默认目标频道 ID 或 @username
                </label>
                <input
                  type="text"
                  value={tgChatId}
                  onChange={(e) => setTgChatId(e.target.value)}
                  placeholder="e.g. @my_channel or -100123456789"
                  className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-telegram hover:underline font-semibold flex items-center gap-1"
              >
                <span>直达 @BotFather 创建机器人 -&gt;</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              <div className="flex items-center gap-2">
                {savedSuccess && (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>连接成功</span>
                  </span>
                )}
                <button
                  type="submit"
                  disabled={tgLoading || !tgBotToken.trim()}
                  className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium disabled:opacity-50 transition-all shadow-glow-terracotta active:scale-95"
                >
                  {tgLoading ? '验证中...' : '连接并保存 Bot'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
