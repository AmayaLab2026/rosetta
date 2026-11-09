import React, { useState, useEffect } from 'react'
import { Account } from '../../../shared/types'
import { CheckCircle2, AlertCircle, RefreshCw, Trash2, Globe, ExternalLink } from 'lucide-react'
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

  // Telegram state
  const [tgApiId, setTgApiId] = useState('')
  const [tgApiHash, setTgApiHash] = useState('')
  const [tgPhone, setTgPhone] = useState('')
  const [tgPhoneCodeHash, setTgPhoneCodeHash] = useState<string | null>(null)
  const [tgCode, setTgCode] = useState('')
  const [tgPassword, setTgPassword] = useState('')
  const [tgLoading, setTgLoading] = useState(false)
  const [tgStep, setTgStep] = useState<'initial' | 'code'>('initial')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  useEffect(() => {
    window.rosetta.getSettings?.().then((settings) => {
      if (settings) {
        if (settings.telegramApiId) setTgApiId(String(settings.telegramApiId))
        if (settings.telegramApiHash) setTgApiHash(settings.telegramApiHash)
        if (settings.telegramPhone) setTgPhone(settings.telegramPhone)
      }
    }).catch(() => {})
  }, [])

  // Auto-fetch avatar if missing for active accounts
  useEffect(() => {
    accounts.forEach((acc) => {
      if (acc.status === 'active' && !acc.avatarUrl) {
        window.rosetta.refreshAccountProfile?.(acc.id).then(() => {
          onAccountUpdated()
        }).catch(() => {})
      }
    })
  }, [accounts])

  const twitterAccount = accounts.find((a) => a.platform === 'twitter')
  const telegramAccount = accounts.find((a) => a.platform === 'telegram')

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
      } else {
        setErrorMsg(health.error || 'Invalid Twitter cookies')
      }
      onAccountUpdated()
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save Twitter account')
    } finally {
      setTwLoading(false)
    }
  }

  // Telegram Code Request
  const handleTgRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tgApiId || !tgApiHash || !tgPhone) return

    setTgLoading(true)
    setErrorMsg(null)
    try {
      const res = await window.rosetta.requestTelegramAuthCode({
        apiId: parseInt(tgApiId.trim(), 10),
        apiHash: tgApiHash.trim(),
        phoneNumber: tgPhone.trim()
      })
      setTgPhoneCodeHash(res.phoneCodeHash)
      setTgStep('code')
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to request Telegram code')
    } finally {
      setTgLoading(false)
    }
  }

  // Telegram Code Submit
  const handleTgSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tgPhoneCodeHash || !tgCode) return

    setTgLoading(true)
    setErrorMsg(null)
    try {
      await window.rosetta.submitTelegramAuthCode({
        phoneNumber: tgPhone.trim(),
        phoneCodeHash: tgPhoneCodeHash,
        code: tgCode.trim(),
        password: tgPassword.trim() || undefined
      })
      setTgStep('initial')
      setTgCode('')
      setTgPassword('')
      onAccountUpdated()
    } catch (err: any) {
      setErrorMsg(err.message || 'Telegram code verification failed')
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
                title="刷新资料与头像 / Verify Session"
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
                    className="w-full bg-surface border border-surface-border rounded px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
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
                    className="w-full bg-surface border border-surface-border rounded px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
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

      {/* Telegram Section */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-telegram-subtle border border-telegram-border flex items-center justify-center font-bold text-xs text-telegram">
              TG
            </div>
            <div>
              <h3 className="text-xs font-semibold text-foreground font-mono">{t.accounts.telegramTitle}</h3>
              <p className="text-[11px] text-gray-500 font-mono">
                {t.accounts.telegramDesc}
              </p>
            </div>
          </div>

          {telegramAccount && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleVerify(telegramAccount.id)}
                title="刷新资料与头像 / Refresh Telegram Profile"
                disabled={refreshingId === telegramAccount.id}
                className="p-1.5 rounded-lg text-gray-600 hover:text-foreground hover:bg-surface-hover border border-surface-border transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === telegramAccount.id ? 'animate-spin text-telegram' : ''}`} />
              </button>
              <button
                onClick={() => handleDelete(telegramAccount.id)}
                title="Disconnect"
                className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 border border-surface-border"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {telegramAccount ? (
          <div className="p-4 rounded-xl bg-surface-muted/60 border border-surface-border flex items-center justify-between shadow-2xs surface-hover-card">
            <div className="flex items-center gap-3">
              {telegramAccount.avatarUrl ? (
                <img
                  src={telegramAccount.avatarUrl}
                  alt={telegramAccount.username}
                  className="w-10 h-10 rounded-full border border-surface-border object-cover shadow-2xs"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-telegram/15 text-telegram flex items-center justify-center font-bold text-sm border border-telegram/20">
                  {telegramAccount.username[0]?.toUpperCase() || 'T'}
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-foreground">{telegramAccount.displayName}</p>
                <p className="text-[11px] font-mono text-gray-500">{telegramAccount.username}</p>
              </div>
            </div>

            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {t.accounts.connectedMtproto}
            </span>
          </div>
        ) : (
          <div>
            {tgStep === 'initial' ? (
              <form onSubmit={handleTgRequestCode} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-mono text-gray-600 block mb-1">
                      {t.accounts.apiIdLabel}
                    </label>
                    <input
                      type="number"
                      required
                      value={tgApiId}
                      onChange={(e) => setTgApiId(e.target.value)}
                      placeholder="e.g. 1234567"
                      className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-gray-600 block mb-1">
                      {t.accounts.apiHashLabel}
                    </label>
                    <input
                      type="text"
                      required
                      value={tgApiHash}
                      onChange={(e) => setTgApiHash(e.target.value)}
                      placeholder="e.g. 0123456789abcdef0123456789abcdef"
                      className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-gray-600 block mb-1">
                    {t.accounts.phoneLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={tgPhone}
                    onChange={(e) => setTgPhone(e.target.value)}
                    placeholder="+86..."
                    className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <a
                    href="https://my.telegram.org/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-telegram hover:underline flex items-center gap-1 font-medium"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t.accounts.howToGetApi}
                  </a>

                  <button
                    type="submit"
                    disabled={tgLoading}
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium shadow-glow-terracotta transition-all"
                  >
                    {tgLoading ? t.accounts.sendingCode : t.accounts.requestCode}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleTgSubmitCode} className="space-y-3">
                <p className="text-xs font-mono text-gray-700">
                  {t.accounts.codeSentTo} <span className="text-telegram font-semibold">{tgPhone}</span>
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-mono text-gray-600 block mb-1">
                      {t.accounts.verifyCodeLabel}
                    </label>
                    <input
                      type="text"
                      required
                      value={tgCode}
                      onChange={(e) => setTgCode(e.target.value)}
                      placeholder="e.g. 12345"
                      className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-gray-600 block mb-1">
                      {t.accounts.twoFaLabel}
                    </label>
                    <input
                      type="password"
                      value={tgPassword}
                      onChange={(e) => setTgPassword(e.target.value)}
                      placeholder="Optional 2FA password"
                      className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setTgStep('initial')}
                    className="text-xs font-mono text-gray-500 hover:text-foreground"
                  >
                    {t.accounts.backToEditPhone}
                  </button>

                  <button
                    type="submit"
                    disabled={tgLoading}
                    className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-mono font-medium shadow-sm"
                  >
                    {tgLoading ? t.accounts.verifying : t.accounts.completeLogin}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
