import React, { useState } from 'react'
import { MirrorLogItem } from '../../../shared/types'
import { Trash2, ExternalLink, Filter, CheckCircle2, AlertCircle, Search } from 'lucide-react'
import { useI18n } from '../i18n'

interface LogsViewProps {
  logs: MirrorLogItem[]
  onClearLogs: () => void
}

export const LogsView: React.FC<LogsViewProps> = ({ logs, onClearLogs }) => {
  const { t } = useI18n()
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'filtered' | 'deleted' | 'failed'>('all')
  const [searchTerm, setSearchTerm] = useState('')

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

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">{t.logs.title}</h2>
          <p className="text-xs text-gray-500 font-mono">
            {t.logs.desc}
          </p>
        </div>

        <button
          onClick={onClearLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-gray-600 hover:text-rose-600 hover:bg-rose-50 text-xs font-mono transition-colors bg-surface shadow-panel"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t.logs.clearLogs}</span>
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-surface border border-surface-border shadow-panel">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {[
            { id: 'all', label: t.logs.filterAll },
            { id: 'success', label: t.logs.filterSuccess },
            { id: 'filtered', label: t.logs.filterFiltered },
            { id: 'deleted', label: t.logs.filterDeleted },
            { id: 'failed', label: t.logs.filterFailed }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterStatus(item.id as any)}
              className={`px-3 py-1 rounded-md text-xs font-mono uppercase tracking-wider transition-colors ${
                filterStatus === item.id
                  ? 'bg-brand-subtle text-brand font-semibold border border-brand-border'
                  : 'text-gray-600 hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.logs.searchPlaceholder}
            className="w-full bg-background border border-surface-border rounded-lg pl-8 pr-3 py-1 text-xs text-foreground font-mono focus:outline-none focus:border-brand"
          />
        </div>
      </div>

      {/* Log list */}
      <div className="space-y-3 font-mono">
        {filteredLogs.map((log) => (
          <div
            key={log.id}
            className="p-4 rounded-xl bg-surface border border-surface-border hover:border-gray-400 transition-colors space-y-2 text-xs shadow-panel"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-[11px]">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
                <span className="text-telegram font-semibold">{log.sourceChannel}</span>
                <span className="text-gray-400">➔</span>
                <span className="text-gray-800 font-semibold">
                  {log.targetPlatform === 'telegram' ? 'Telegram' : 'X / Twitter'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {log.status === 'processing' && (
                  <span className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    <span>处理中...</span>
                  </span>
                )}
                {log.status === 'success' && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                    <CheckCircle2 className="w-3 h-3" />
                    {t.studio.mirrored}
                  </span>
                )}
                {log.status === 'filtered' && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
                    <Filter className="w-3 h-3" />
                    {t.studio.filtered}
                  </span>
                )}
                {log.status === 'deleted' && (
                  <span className="flex items-center gap-1 text-[11px] text-rose-900 bg-rose-50 px-2 py-0.5 rounded border border-rose-300">
                    <Trash2 className="w-3 h-3 text-rose-600" />
                    {t.studio.deleted}
                  </span>
                )}
                {log.status === 'failed' && (
                  <span className="flex items-center gap-1 text-[11px] text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-300">
                    <AlertCircle className="w-3 h-3" />
                    {t.studio.failed}
                  </span>
                )}
                {log.targetUrl && (
                  <a
                    href={log.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand hover:underline flex items-center gap-1 text-[11px] font-semibold"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t.logs.viewLink}
                  </a>
                )}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="text-gray-700 text-[11px] bg-surface-muted/50 p-2.5 rounded border border-surface-border">
                <span className="text-gray-500 block text-[10px] uppercase tracking-wider mb-0.5 font-medium">
                  {t.logs.sourceTelegram}
                </span>
                <span className="whitespace-pre-wrap">{log.originalText}</span>
              </div>

              {log.processedText && (
                <div className="text-foreground text-[11px] bg-surface p-2.5 rounded border border-surface-border shadow-sm">
                  <span className="text-gray-500 block text-[10px] uppercase tracking-wider mb-0.5 font-medium">
                    {t.logs.mirroredTweet}
                  </span>
                  <span className="whitespace-pre-wrap">{log.processedText}</span>
                </div>
              )}

              {log.errorMessage && (
                <div className="text-rose-800 text-[11px] bg-rose-50 p-2.5 rounded border border-rose-300">
                  {log.errorMessage}
                </div>
              )}
            </div>
          </div>
        ))}

        {filteredLogs.length === 0 && (
          <div className="py-16 text-center text-gray-500 rounded-xl bg-surface border border-surface-border text-xs shadow-panel">
            {t.logs.noLogs}
          </div>
        )}
      </div>
    </div>
  )
}
