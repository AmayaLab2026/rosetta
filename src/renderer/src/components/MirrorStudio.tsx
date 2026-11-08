import React from 'react'
import { MirrorLogItem, MirrorRule, Account } from '../../../shared/types'
import { Radio, ArrowRight, ExternalLink, CheckCircle2, AlertCircle, Filter, Sparkles } from 'lucide-react'
import { useI18n } from '../i18n'

interface MirrorStudioProps {
  engineRunning: boolean
  rules: MirrorRule[]
  accounts: Account[]
  logs: MirrorLogItem[]
  onOpenRules: () => void
  onOpenAccounts: () => void
}

export const MirrorStudio: React.FC<MirrorStudioProps> = ({
  engineRunning,
  rules,
  accounts,
  logs,
  onOpenRules,
  onOpenAccounts
}) => {
  const { t } = useI18n()
  const activeRules = rules.filter((r) => r.enabled)
  const totalForwarded = logs.filter((l) => l.status === 'success').length
  const totalFiltered = logs.filter((l) => l.status === 'filtered').length
  const totalFailed = logs.filter((l) => l.status === 'failed').length

  const telegramAccount = accounts.find((a) => a.platform === 'telegram' && a.status === 'active')
  const twitterAccount = accounts.find((a) => a.platform === 'twitter' && a.status === 'active')

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      {/* Topology Pipeline Card */}
      <div className="p-5 rounded-xl bg-surface border border-surface-border shadow-panel relative overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-brand animate-pulse-subtle" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider font-mono">
              {t.studio.topologyTitle}
            </h2>
          </div>
          <span
            className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border ${
              engineRunning
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-surface-muted text-gray-500 border-surface-border'
            }`}
          >
            {engineRunning ? t.studio.listeningEvents : t.studio.engineIdle}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Source node */}
          <div className="p-3.5 rounded-lg bg-background border border-surface-border">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-mono text-telegram font-semibold">
                {t.studio.sourceTelegram}
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  telegramAccount ? 'bg-telegram shadow-sm' : 'bg-gray-300'
                }`}
              />
            </div>
            {telegramAccount ? (
              <div>
                <p className="text-xs font-semibold text-foreground truncate">{telegramAccount.displayName}</p>
                <p className="text-[11px] font-mono text-gray-500 truncate">{telegramAccount.username}</p>
              </div>
            ) : (
              <button
                onClick={onOpenAccounts}
                className="text-xs text-brand hover:underline flex items-center gap-1 font-mono mt-1 font-medium"
              >
                {t.studio.connectTelegram}
              </button>
            )}
          </div>

          {/* Middleware Node */}
          <div className="p-3.5 rounded-lg bg-brand-subtle/50 border border-brand-border/60 flex flex-col justify-center items-center text-center relative">
            <div className="flex items-center gap-1.5 text-xs font-mono text-brand font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5 text-brand" />
              <span>Rosetta Pipeline</span>
            </div>
            <p className="text-[11px] text-gray-600 font-mono">
              {activeRules.length} {t.studio.pipelineRulesActive}
            </p>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {t.studio.pipelineSub}
            </div>
          </div>

          {/* Target node */}
          <div className="p-3.5 rounded-lg bg-background border border-surface-border">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-mono text-gray-800 font-semibold">
                {t.studio.targetTwitter}
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  twitterAccount ? 'bg-twitter shadow-sm' : 'bg-gray-300'
                }`}
              />
            </div>
            {twitterAccount ? (
              <div>
                <p className="text-xs font-semibold text-foreground truncate">{twitterAccount.displayName}</p>
                <p className="text-[11px] font-mono text-gray-500 truncate">@{twitterAccount.username}</p>
              </div>
            ) : (
              <button
                onClick={onOpenAccounts}
                className="text-xs text-brand hover:underline flex items-center gap-1 font-mono mt-1 font-medium"
              >
                {t.studio.connectTwitter}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-4 gap-4 font-mono">
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">{t.studio.processedTotal}</div>
          <div className="text-2xl font-semibold text-foreground mt-1">{logs.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel">
          <div className="text-[11px] text-emerald-700 uppercase tracking-wider">{t.studio.mirroredToX}</div>
          <div className="text-2xl font-semibold text-emerald-700 mt-1">{totalForwarded}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel">
          <div className="text-[11px] text-amber-700 uppercase tracking-wider">{t.studio.filteredAds}</div>
          <div className="text-2xl font-semibold text-amber-700 mt-1">{totalFiltered}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel">
          <div className="text-[11px] text-rose-700 uppercase tracking-wider">{t.studio.failedDispatches}</div>
          <div className="text-2xl font-semibold text-rose-700 mt-1">{totalFailed}</div>
        </div>
      </div>

      {/* Live Activity Stream */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider font-mono">
            {t.studio.liveStreamFeed} ({logs.length})
          </h3>
          <span className="text-[11px] font-mono text-gray-500">{t.studio.liveStreamDesc}</span>
        </div>

        {logs.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <Radio className="w-8 h-8 text-gray-400" />
            <p className="text-xs text-gray-500 max-w-sm text-center">
              {t.studio.waitingEvents}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.slice(0, 20).map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-lg bg-surface-muted/40 border border-surface-border hover:border-gray-400 transition-colors space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="text-gray-300">•</span>
                    <span className="text-telegram font-semibold">{log.sourceChannel}</span>
                    <ArrowRight className="w-3 h-3 text-gray-400" />
                    <span className="text-gray-800 font-semibold">X / Twitter</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {log.status === 'success' && (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3" />
                        {t.studio.mirrored}
                      </span>
                    )}
                    {log.status === 'filtered' && (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
                        <Filter className="w-3 h-3" />
                        {t.studio.filtered}
                      </span>
                    )}
                    {log.status === 'failed' && (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-300">
                        <AlertCircle className="w-3 h-3" />
                        {t.studio.failed}
                      </span>
                    )}
                    {log.targetUrl && (
                      <a
                        href={log.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline flex items-center gap-1 font-mono text-[11px] font-medium"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t.studio.viewTweet}
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="bg-surface p-2.5 rounded border border-surface-border shadow-sm">
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block mb-1">
                      {t.studio.rawTelegram}
                    </span>
                    <p className="text-gray-700 font-mono text-[11px] line-clamp-3 whitespace-pre-wrap">
                      {log.originalText}
                    </p>
                  </div>
                  <div className="bg-surface p-2.5 rounded border border-surface-border shadow-sm">
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block mb-1">
                      {t.studio.processedForX}
                    </span>
                    <p className="text-foreground font-mono text-[11px] line-clamp-3 whitespace-pre-wrap">
                      {log.processedText || (
                        <span className="text-gray-400 italic">{t.studio.noOutput}</span>
                      )}
                    </p>
                    {log.errorMessage && (
                      <p className="text-[11px] text-rose-600 font-mono mt-1">
                        Error: {log.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
