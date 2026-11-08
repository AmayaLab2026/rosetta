import React, { useState } from 'react'
import { MirrorRule, Account } from '../../../shared/types'
import { Plus, Trash2, ArrowRight, X, Sliders } from 'lucide-react'
import { useI18n } from '../i18n'

interface RulesManagerProps {
  rules: MirrorRule[]
  accounts: Account[]
  onRuleUpdated: () => void
}

export const RulesManager: React.FC<RulesManagerProps> = ({
  rules,
  accounts,
  onRuleUpdated
}) => {
  const { t } = useI18n()
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [sourceChannel, setSourceChannel] = useState('')
  const [targetAccountId, setTargetAccountId] = useState('')
  const [removeTelegramLinks, setRemoveTelegramLinks] = useState(true)
  const [removeOtherLinks, setRemoveOtherLinks] = useState(false)
  const [removeHashtags, setRemoveHashtags] = useState(false)
  const [adKeywords, setAdKeywords] = useState('t.me/,广告,推广,联系客服,群主')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [autoSplitThread, setAutoSplitThread] = useState(true)
  const [autoSyncDeletion, setAutoSyncDeletion] = useState(true)

  const twitterAccounts = accounts.filter((a) => a.platform === 'twitter' && a.status === 'active')

  const handleToggle = async (ruleId: string, currentEnabled: boolean) => {
    await window.rosetta.toggleMirrorRule(ruleId, !currentEnabled)
    onRuleUpdated()
  }

  const handleDelete = async (ruleId: string) => {
    if (confirm('Delete this mirror rule?')) {
      await window.rosetta.deleteMirrorRule(ruleId)
      onRuleUpdated()
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sourceChannel.trim() || !targetAccountId) return

    const targetAcc = accounts.find((a) => a.id === targetAccountId)

    const newRule: MirrorRule = {
      id: `rule_${Date.now()}`,
      name: name.trim() || `Mirror ${sourceChannel} ➔ @${targetAcc?.username}`,
      enabled: true,
      sourceChannel: {
        username: sourceChannel.trim().replace(/^https?:\/\/t\.me\//, '@')
      },
      targetAccount: {
        platform: 'twitter',
        accountId: targetAccountId,
        accountName: targetAcc?.username
      },
      filters: {
        removeTelegramLinks,
        removeOtherLinks,
        removeHashtags,
        stripAdKeywords: adKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        customReplacements: [],
        prefix: prefix.trim() || undefined,
        suffix: suffix.trim() || undefined,
        autoSplitThread,
        autoSyncDeletion,
        forwardMedia: true
      },
      stats: {
        totalReceived: 0,
        totalForwarded: 0
      },
      createdAt: new Date().toISOString()
    }

    await window.rosetta.saveMirrorRule(newRule)
    setIsCreating(false)
    setName('')
    setSourceChannel('')
    onRuleUpdated()
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">
            {t.rules.title}
          </h2>
          <p className="text-xs text-gray-500 font-mono">
            {t.rules.desc}
          </p>
        </div>

        <button
          onClick={() => {
            if (twitterAccounts.length > 0 && !targetAccountId) {
              setTargetAccountId(twitterAccounts[0].id)
            }
            setIsCreating(true)
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium shadow-glow-terracotta transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t.rules.newRule}</span>
        </button>
      </div>

      {/* Creation Modal / Form */}
      {isCreating && (
        <form
          onSubmit={handleSave}
          className="p-5 rounded-xl bg-surface border border-brand/50 shadow-panel-card space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-surface-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-brand flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-brand" />
              {t.rules.configureNewRule}
            </h3>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="text-gray-400 hover:text-gray-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-mono text-gray-600 block mb-1">
                {t.rules.ruleName}
              </label>
              <input
                type="text"
                placeholder="e.g. Tech News to X"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
              />
            </div>

            <div>
              <label className="text-[11px] font-mono text-gray-600 block mb-1">
                {t.rules.sourceChannelLabel}
              </label>
              <input
                type="text"
                required
                placeholder="@channel_name or https://t.me/channel_name"
                value={sourceChannel}
                onChange={(e) => setSourceChannel(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
              />
            </div>

            <div>
              <label className="text-[11px] font-mono text-gray-600 block mb-1">
                {t.rules.targetAccountLabel}
              </label>
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
              >
                {twitterAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    @{acc.username} ({acc.displayName})
                  </option>
                ))}
              </select>
              {twitterAccounts.length === 0 && (
                <p className="text-[11px] text-amber-700 font-mono mt-1">
                  {t.rules.noTwitterAccounts}
                </p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-mono text-gray-600 block mb-1">
                {t.rules.adKeywordsLabel}
              </label>
              <input
                type="text"
                value={adKeywords}
                onChange={(e) => setAdKeywords(e.target.value)}
                placeholder="t.me/,广告,推广,联系客服"
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          {/* Filter switches */}
          <div className="pt-2 border-t border-surface-border grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono text-gray-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={removeTelegramLinks}
                onChange={(e) => setRemoveTelegramLinks(e.target.checked)}
                className="rounded border-surface-border text-brand focus:ring-brand"
              />
              <span>{t.rules.stripTgLinks}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={removeOtherLinks}
                onChange={(e) => setRemoveOtherLinks(e.target.checked)}
                className="rounded border-surface-border text-brand focus:ring-brand"
              />
              <span>{t.rules.stripAllLinks}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={removeHashtags}
                onChange={(e) => setRemoveHashtags(e.target.checked)}
                className="rounded border-surface-border text-brand focus:ring-brand"
              />
              <span>{t.rules.stripHashtags}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSplitThread}
                onChange={(e) => setAutoSplitThread(e.target.checked)}
                className="rounded border-surface-border text-brand focus:ring-brand"
              />
              <span>{t.rules.autoThread}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSyncDeletion}
                onChange={(e) => setAutoSyncDeletion(e.target.checked)}
                className="rounded border-surface-border text-brand focus:ring-brand"
              />
              <span className="text-brand font-medium">{t.rules.autoSyncDeletion}</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-4 py-1.5 rounded-lg border border-surface-border text-gray-600 hover:text-foreground text-xs font-mono"
            >
              {t.rules.cancel}
            </button>
            <button
              type="submit"
              disabled={twitterAccounts.length === 0}
              className="px-5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium disabled:opacity-50"
            >
              {t.rules.saveRule}
            </button>
          </div>
        </form>
      )}

      {/* Rules List */}
      <div className="space-y-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`p-4 rounded-xl bg-surface border transition-all shadow-panel ${
              rule.enabled
                ? 'border-surface-border hover:border-gray-400'
                : 'border-surface-border/60 opacity-60 bg-surface-muted/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h4 className="text-xs font-semibold text-foreground font-mono">{rule.name}</h4>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.2 rounded ${
                      rule.enabled
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                        : 'bg-surface-muted text-gray-500 border border-surface-border'
                    }`}
                  >
                    {rule.enabled ? t.rules.active : t.rules.paused}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
                  <span className="text-telegram font-medium">{rule.sourceChannel.username}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-800 font-medium">
                    @{rule.targetAccount.accountName || rule.targetAccount.accountId}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(rule.id, rule.enabled)}
                  className={`px-3 py-1 rounded text-xs font-mono transition-colors border ${
                    rule.enabled
                      ? 'bg-surface text-gray-700 border-surface-border hover:bg-surface-hover'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  }`}
                >
                  {rule.enabled ? t.rules.pause : t.rules.activate}
                </button>

                <button
                  onClick={() => handleDelete(rule.id)}
                  className="p-1.5 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Filter pills & stats */}
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-surface-border text-[11px] font-mono text-gray-500">
              <div className="flex items-center gap-2">
                {rule.filters.removeTelegramLinks && (
                  <span className="bg-surface-muted px-1.5 py-0.5 rounded border border-surface-border text-gray-600">
                    {t.rules.noTgLinksBadge}
                  </span>
                )}
                {rule.filters.autoSplitThread && (
                  <span className="bg-surface-muted px-1.5 py-0.5 rounded border border-surface-border text-gray-600">
                    {t.rules.autoThreadBadge}
                  </span>
                )}
                {rule.filters.autoSyncDeletion !== false && (
                  <span className="bg-brand-subtle px-1.5 py-0.5 rounded border border-brand-border text-brand font-medium">
                    {t.rules.autoSyncDeletionBadge}
                  </span>
                )}
                {rule.filters.stripAdKeywords.length > 0 && (
                  <span className="bg-surface-muted px-1.5 py-0.5 rounded border border-surface-border text-gray-600">
                    {rule.filters.stripAdKeywords.length} {t.rules.adFiltersBadge}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span>{t.rules.received}: {rule.stats.totalReceived}</span>
                <span>{t.rules.mirroredCount}: {rule.stats.totalForwarded}</span>
              </div>
            </div>
          </div>
        ))}

        {rules.length === 0 && !isCreating && (
          <div className="py-16 text-center rounded-xl bg-surface border border-surface-border space-y-2 shadow-panel">
            <Sliders className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="text-xs text-foreground font-mono font-medium">{t.rules.noRules}</p>
            <p className="text-[11px] text-gray-500 font-mono">
              {t.rules.noRulesDesc}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
