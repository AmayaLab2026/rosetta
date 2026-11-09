import React, { useState } from 'react'
import { MirrorLogItem } from '../../../shared/types'
import {
  Trash2,
  ExternalLink,
  Filter,
  CheckCircle2,
  AlertCircle,
  Search,
  Zap,
  Copy,
  Check,
  ImageIcon,
  Radio,
  ArrowRight
} from 'lucide-react'
import { useI18n } from '../i18n'

interface LogsViewProps {
  logs: MirrorLogItem[]
  onClearLogs: () => void
}

export const LogsView: React.FC<LogsViewProps> = ({ logs, onClearLogs }) => {
  const { t } = useI18n()
  const [filterStatus, setFilterStatus] = useState<'all' | 'processing' | 'success' | 'filtered' | 'deleted' | 'failed'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const countProcessing = logs.filter((l) => l.status === 'processing').length
  const countSuccess = logs.filter((l) => l.status === 'success').length
  const countFiltered = logs.filter((l) => l.status === 'filtered').length
  const countDeleted = logs.filter((l) => l.status === 'deleted').length
  const countFailed = logs.filter((l) => l.status === 'failed').length

  const filteredLogs = logs.filter((log) => {
    if (filterStatus !== 'all' && log.status !== filterStatus) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      return (
        log.sourceChannel.toLowerCase().includes(q) ||
        log.originalText.toLowerCase().includes(q) ||
        log.processedText.toLowerCase().includes(q)
      )
    }
    return true
  })

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">{t.logs.title}</h2>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{t.logs.liveStreamReady}</span>
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {t.logs.desc}
          </p>
        </div>

        <button
          onClick={onClearLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-gray-600 hover:text-rose-600 hover:bg-rose-50 text-xs font-mono transition-all bg-surface shadow-panel hover:border-rose-300 active:scale-95 self-start sm:self-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t.logs.clearLogs}</span>
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-surface border border-surface-border shadow-panel">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {[
            { id: 'all', label: t.logs.filterAll, count: logs.length },
            { id: 'processing', label: t.logs.filterProcessing, count: countProcessing },
            { id: 'success', label: t.logs.filterSuccess, count: countSuccess },
            { id: 'filtered', label: t.logs.filterFiltered, count: countFiltered },
            ...(countDeleted > 0 ? [{ id: 'deleted', label: t.logs.filterDeleted, count: countDeleted }] : []),
            { id: 'failed', label: t.logs.filterFailed, count: countFailed }
          ].map((item) => {
            const isSelected = filterStatus === item.id
            return (
              <button
                key={item.id}
                onClick={() => setFilterStatus(item.id as any)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono tracking-wider transition-all ${
                  isSelected
                    ? 'bg-brand-subtle text-brand font-semibold border border-brand-border shadow-2xs'
                    : 'text-gray-600 hover:text-foreground hover:bg-surface-hover border border-transparent'
                }`}
              >
                <span>{item.label}</span>
                {item.count > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? 'bg-brand/15 text-brand font-bold'
                        : 'bg-surface-muted text-gray-500'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.logs.searchPlaceholder}
            className="w-full bg-background border border-surface-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30 transition-all shadow-2xs"
          />
        </div>
      </div>

      {/* Log list */}
      <div className="space-y-3 font-mono">
        {filteredLogs.map((log) => {
          const isProc = log.status === 'processing'
          return (
            <div
              key={log.id}
              className={`p-4 rounded-xl bg-surface border transition-all space-y-2.5 text-xs shadow-panel ${
                isProc
                  ? 'border-amber-300 ring-1 ring-amber-200/50 bg-amber-50/20'
                  : 'border-surface-border hover:border-gray-400 surface-hover-card'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-500 text-[11px]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-gray-300">•</span>
                  <span className="text-telegram font-semibold bg-telegram-subtle px-1.5 py-0.5 rounded border border-telegram-border/50 text-[11px]">
                    {log.sourceChannel}
                  </span>
                  <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                  <span className="font-semibold text-[11px]">
                    {log.targetPlatform === 'both' ? (
                      <span className="text-brand bg-brand-subtle px-1.5 py-0.5 rounded border border-brand-border/60">
                        [X + TG 双端广播]
                      </span>
                    ) : log.targetPlatform === 'telegram' ? (
                      <span className="text-telegram bg-telegram-subtle px-1.5 py-0.5 rounded border border-telegram-border/50">
                        Telegram 频道
                      </span>
                    ) : (
                      <span className="text-gray-800 bg-surface px-1.5 py-0.5 rounded border border-surface-border">
                        X (Twitter)
                      </span>
                    )}
                  </span>

                  {log.mediaCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-gray-600 bg-surface-muted px-1.5 py-0.5 rounded border border-surface-border">
                      <ImageIcon className="w-3 h-3 text-brand" />
                      <span>{`${log.mediaCount} ${t.logs.attachmentsCount}`}</span>
                    </span>
                  )}

                  {typeof log.durationMs === 'number' && log.durationMs > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-semibold" title="发布响应耗时">
                      <Zap className="w-2.5 h-2.5 text-emerald-600" />
                      <span>{log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(2)}s`}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {log.status === 'processing' && (
                    <span className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-300 shadow-2xs font-medium">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                      </span>
                      <span>{t.logs.filterProcessing}...</span>
                    </span>
                  )}
                  {log.status === 'success' && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-300 font-medium shadow-2xs">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>
                        {log.targetPlatform === 'both'
                          ? '双端已发'
                          : log.targetPlatform === 'telegram'
                          ? '频道已发'
                          : t.studio.mirrored}
                      </span>
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
                      <span>{t.logs.viewLink}</span>
                    </a>
                  )}
                </div>
              </div>

              {/* Progress shimmer line if processing */}
              {isProc && (
                <div className="w-full h-1 bg-amber-100 rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 animate-shimmer" />
                </div>
              )}

              {/* Content Cards */}
              <div className="space-y-1.5 pt-0.5">
                <div className="text-gray-700 text-[11px] bg-surface-muted/60 p-2.5 rounded-lg border border-surface-border">
                  <div className="flex items-center justify-between text-gray-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">
                    <span>{t.logs.sourceTelegram}</span>
                    <button
                      onClick={() => copyText(`orig_${log.id}`, log.originalText)}
                      className="text-gray-400 hover:text-gray-700 flex items-center gap-1 normal-case tracking-normal transition-colors"
                      title="复制原始消息"
                    >
                      {copiedId === `orig_${log.id}` ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-700 text-[10px]">{t.logs.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{t.logs.copy}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <span className="whitespace-pre-wrap leading-relaxed select-text font-sans text-xs text-foreground/90">{log.originalText}</span>
                </div>

                {log.processedText && (
                  <div className="text-foreground text-[11px] bg-white p-2.5 rounded-lg border border-surface-border shadow-2xs">
                    <div className="flex items-center justify-between text-gray-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">
                      <span>{t.logs.mirroredTweet}</span>
                      <button
                        onClick={() => copyText(`proc_${log.id}`, log.processedText)}
                        className="text-gray-400 hover:text-gray-700 flex items-center gap-1 normal-case tracking-normal transition-colors"
                        title="复制发布内容"
                      >
                        {copiedId === `proc_${log.id}` ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700 text-[10px]">{t.logs.copied}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>{t.logs.copy}</span>
                          </>
                        )}
                      </button>
                    </div>
                    <span className="whitespace-pre-wrap leading-relaxed select-text font-sans text-xs text-foreground">{log.processedText}</span>
                  </div>
                )}

                {log.errorMessage && (
                  <div className="text-rose-900 text-[11px] bg-rose-50/80 p-2.5 rounded-lg border border-rose-200 font-mono">
                    <span className="font-semibold block mb-0.5 text-rose-700">{t.logs.errorDetail}</span>
                    <span className="select-text">{log.errorMessage}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {filteredLogs.length === 0 && (
          <div className="py-16 text-center text-gray-500 rounded-xl bg-surface border border-surface-border text-xs shadow-panel space-y-2">
            <Radio className="w-7 h-7 mx-auto text-gray-300 animate-pulse-subtle" />
            <p>{t.logs.noLogs}</p>
          </div>
        )}
      </div>
    </div>
  )
}
