import React from 'react'
import { MirrorLogItem, MirrorRule, Account } from '../../../shared/types'
import {
  Radio,
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Filter,
  Sparkles,
  Trash2,
  Zap,
  ImageIcon,
  Send,
  Layers,
  Activity
} from 'lucide-react'
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
  const totalProcessing = logs.filter((l) => l.status === 'processing').length

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
            className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border shadow-2xs font-medium flex items-center gap-1.5 ${
              engineRunning
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-surface-muted text-gray-500 border-surface-border'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                engineRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
              }`}
            />
            <span>{engineRunning ? t.studio.listeningEvents : t.studio.engineIdle}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center relative">
          {/* Source node */}
          <div className="p-4 rounded-xl bg-background border border-surface-border relative shadow-2xs surface-hover-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono text-telegram font-semibold uppercase tracking-wider">
                {t.studio.sourceTelegram}
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  telegramAccount ? 'bg-telegram shadow-sm' : 'bg-gray-300'
                }`}
              />
            </div>
            {telegramAccount ? (
              <div className="flex items-center gap-3">
                {telegramAccount.avatarUrl ? (
                  <img
                    src={telegramAccount.avatarUrl}
                    alt={telegramAccount.username}
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                    className="w-9 h-9 rounded-full border border-surface-border object-cover shrink-0 shadow-2xs"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-telegram/15 text-telegram flex items-center justify-center font-bold text-xs shrink-0 border border-telegram/20">
                    {telegramAccount.username[0]?.toUpperCase() || 'T'}
                  </div>
                )}
                <div className="overflow-hidden">
                  <p className="text-xs font-semibold text-foreground truncate">{telegramAccount.displayName}</p>
                  <p className="text-[11px] font-mono text-gray-500 truncate">{telegramAccount.username}</p>
                </div>
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
          <div className="p-4 rounded-xl bg-brand-subtle/50 border border-brand-border/60 flex flex-col justify-center items-center text-center relative shadow-2xs surface-hover-card">
            <div className="flex items-center gap-1.5 text-xs font-mono text-brand font-semibold mb-1">
              <Sparkles className="w-4 h-4 text-brand" />
              <span>Rosetta Pipeline</span>
            </div>
            <p className="text-[11px] text-gray-600 font-mono font-medium">
              {activeRules.length} {t.studio.pipelineRulesActive}
            </p>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {t.studio.pipelineSub}
            </div>
          </div>

          {/* Target node */}
          <div className="p-4 rounded-xl bg-background border border-surface-border relative shadow-2xs surface-hover-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono text-gray-800 font-semibold uppercase tracking-wider">
                {t.studio.targetTwitter}
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  twitterAccount ? 'bg-twitter shadow-sm' : 'bg-gray-300'
                }`}
              />
            </div>
            {twitterAccount ? (
              <div className="flex items-center gap-3">
                {twitterAccount.avatarUrl ? (
                  <img
                    src={twitterAccount.avatarUrl}
                    alt={twitterAccount.username}
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                    className="w-9 h-9 rounded-full border border-surface-border object-cover shrink-0 shadow-2xs"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-brand-subtle text-brand flex items-center justify-center font-bold text-xs shrink-0 border border-brand-border">
                    {twitterAccount.username[0]?.toUpperCase() || 'X'}
                  </div>
                )}
                <div className="overflow-hidden">
                  <p className="text-xs font-semibold text-foreground truncate">{twitterAccount.displayName}</p>
                  <p className="text-[11px] font-mono text-gray-500 truncate">@{twitterAccount.username}</p>
                </div>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono">
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel surface-hover-card">
          <div className="flex items-center justify-between text-[11px] text-gray-500 uppercase tracking-wider">
            <span>{t.studio.processedTotal}</span>
            <Activity className="w-3.5 h-3.5 text-gray-400" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-1.5">{logs.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel surface-hover-card">
          <div className="flex items-center justify-between text-[11px] text-emerald-700 uppercase tracking-wider font-semibold">
            <span>{t.studio.mirroredToX}</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-1.5">{totalForwarded}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel surface-hover-card">
          <div className="flex items-center justify-between text-[11px] text-amber-700 uppercase tracking-wider font-semibold">
            <span>{t.studio.filteredAds}</span>
            <Filter className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700 mt-1.5">{totalFiltered}</div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel surface-hover-card">
          <div className="flex items-center justify-between text-[11px] text-rose-700 uppercase tracking-wider font-semibold">
            <span>{t.studio.failedDispatches}</span>
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-700 mt-1.5">{totalFailed}</div>
        </div>
      </div>

      {/* Live Activity Stream */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider font-mono">
              {t.studio.liveStreamFeed} ({logs.length})
            </h3>
            {totalProcessing > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                <span>{`${totalProcessing} ${t.logs.filterProcessing}`}</span>
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-gray-500">{t.studio.liveStreamDesc}</span>
        </div>

        {logs.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <Radio className="w-8 h-8 text-gray-300 animate-pulse-subtle" />
            <p className="text-xs text-gray-500 max-w-sm text-center">
              {t.studio.waitingEvents}
            </p>
          </div>
        ) : (
          <div className="space-y-3 font-mono">
            {logs.slice(0, 20).map((log) => {
              const isProc = log.status === 'processing'
              return (
                <div
                  key={log.id}
                  className={`p-3.5 rounded-xl bg-surface-muted/40 border transition-all space-y-2 text-xs shadow-2xs ${
                    isProc
                      ? 'border-amber-300 ring-1 ring-amber-200/50 bg-amber-50/20'
                      : 'border-surface-border hover:border-gray-400 surface-hover-card'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] flex-wrap">
                      <span className="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className="text-gray-300">•</span>
                      <span className="text-telegram font-semibold bg-telegram-subtle px-1.5 py-0.5 rounded border border-telegram-border/50">
                        {log.sourceChannel}
                      </span>
                      <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="text-gray-800 font-semibold">
                        {log.targetPlatform === 'telegram' ? 'Telegram' : 'X (Twitter)'}
                      </span>

                      {log.mediaCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-600 bg-surface px-1.5 py-0.5 rounded border border-surface-border">
                          <ImageIcon className="w-3 h-3 text-brand" />
                          <span>{`${log.mediaCount} ${t.logs.attachmentsCount}`}</span>
                        </span>
                      )}

                      {typeof log.durationMs === 'number' && log.durationMs > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-semibold">
                          <Zap className="w-2.5 h-2.5 text-emerald-600" />
                          <span>{log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(2)}s`}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {log.status === 'processing' && (
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-300 font-medium">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                          </span>
                          <span>{t.studio.processing}</span>
                        </span>
                      )}
                      {log.status === 'success' && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-300 font-medium">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>{t.studio.mirrored}</span>
                        </span>
                      )}
                      {log.status === 'filtered' && (
                        <span className="flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-300 font-medium">
                          <Filter className="w-3 h-3 text-amber-600" />
                          <span>{t.studio.filtered}</span>
                        </span>
                      )}
                      {log.status === 'deleted' && (
                        <span className="flex items-center gap-1 text-[11px] text-purple-900 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-300 font-medium">
                          <Trash2 className="w-3 h-3 text-purple-600" />
                          <span>{t.studio.deleted}</span>
                        </span>
                      )}
                      {log.status === 'failed' && (
                        <span className="flex items-center gap-1 text-[11px] text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-300 font-medium">
                          <AlertCircle className="w-3 h-3 text-rose-600" />
                          <span>{t.studio.failed}</span>
                        </span>
                      )}
                      {log.targetUrl && (
                        <a
                          href={log.targetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand hover:text-brand-hover hover:underline flex items-center gap-1 text-[11px] font-semibold bg-brand-subtle px-2 py-0.5 rounded border border-brand-border/60 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>{t.studio.viewTweet}</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="bg-surface p-2.5 rounded-lg border border-surface-border shadow-2xs">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1 font-semibold">
                        {t.studio.rawTelegram}
                      </span>
                      <p className="text-gray-700 text-[11px] line-clamp-3 whitespace-pre-wrap font-sans leading-relaxed select-text">
                        {log.originalText}
                      </p>
                    </div>
                    <div className="bg-surface p-2.5 rounded-lg border border-surface-border shadow-2xs">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1 font-semibold">
                        {t.studio.processedForX}
                      </span>
                      <p className="text-foreground text-[11px] line-clamp-3 whitespace-pre-wrap font-sans leading-relaxed select-text">
                        {log.processedText || (
                          <span className="text-gray-400 italic font-mono">{t.studio.noOutput}</span>
                        )}
                      </p>
                      {log.errorMessage && (
                        <p className="text-[11px] text-rose-700 font-mono mt-1 bg-rose-50 p-1.5 rounded border border-rose-200">
                          Error: {log.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
