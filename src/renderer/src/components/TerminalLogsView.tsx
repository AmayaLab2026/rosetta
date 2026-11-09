import React, { useState, useEffect, useRef } from 'react'
import { TerminalLogItem } from '../../../shared/types'
import {
  Terminal,
  Trash2,
  Copy,
  Check,
  Search,
  Download,
  ArrowDownCircle,
  PauseCircle,
  Zap,
  Filter,
  CheckCircle2,
  AlertTriangle,
  AlertCircle
} from 'lucide-react'
import { useI18n } from '../i18n'

interface TerminalLogsViewProps {
  logs: TerminalLogItem[]
  onClearLogs: () => void
}

export const TerminalLogsView: React.FC<TerminalLogsViewProps> = ({ logs, onClearLogs }) => {
  const { t } = useI18n()
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [copiedAll, setCopiedAll] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const countInfo = logs.filter((l) => l.level === 'info').length
  const countWarn = logs.filter((l) => l.level === 'warn').length
  const countError = logs.filter((l) => l.level === 'error').length

  const filteredLogs = logs.filter((item) => {
    if (levelFilter !== 'all' && item.level !== levelFilter) return false
    if (searchQuery.trim()) {
      return item.message.toLowerCase().includes(searchQuery.toLowerCase())
    }
    return true
  })

  // Auto scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // Handle user scroll detection
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false)
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true)
    }
  }

  const handleCopyAll = () => {
    const fullText = filteredLogs
      .map(
        (l) =>
          `[${new Date(l.timestamp).toLocaleTimeString()}.${String(
            new Date(l.timestamp).getMilliseconds()
          ).padStart(3, '0')}] [${l.level.toUpperCase()}] ${l.message}`
      )
      .join('\n')
    navigator.clipboard.writeText(fullText)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  const handleExport = () => {
    const fullText = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n')
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rosetta-terminal-${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatMessage = (msg: string) => {
    // Highlight prefixes like [Rosetta], [Mirror], [TwitterDriver], etc. in Claude warm palette
    return msg.split(/(\[[a-zA-Z0-9_\-]+\])/g).map((part, i) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        let colorClass = 'text-amber-300 font-semibold'
        if (part.includes('Rosetta')) colorClass = 'text-[#E08A6F] font-bold' // signature terracotta
        else if (part.includes('Mirror')) colorClass = 'text-emerald-400 font-bold'
        else if (part.includes('Twitter')) colorClass = 'text-sky-300 font-bold'
        else if (part.includes('Store')) colorClass = 'text-purple-300 font-bold'
        else if (part.includes('IPC')) colorClass = 'text-pink-300 font-bold'
        return (
          <span key={i} className={colorClass}>
            {part}
          </span>
        )
      }
      return part
    })
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto h-full flex flex-col overflow-hidden font-sans">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-foreground font-mono tracking-tight flex items-center gap-2">
              <Terminal className="w-4 h-4 text-brand" />
              <span>{t.terminal.title}</span>
            </h2>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{t.terminal.liveConsole}</span>
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {t.terminal.desc}
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto font-mono text-xs">
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-gray-700 hover:text-foreground hover:bg-surface-hover transition-all bg-surface shadow-panel active:scale-95"
            title={t.terminal.copyAll}
          >
            {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-gray-500" />}
            <span>{copiedAll ? t.terminal.copied : t.terminal.copyAll}</span>
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-gray-700 hover:text-foreground hover:bg-surface-hover transition-all bg-surface shadow-panel active:scale-95"
            title={t.terminal.export}
          >
            <Download className="w-3.5 h-3.5 text-gray-500" />
            <span>{t.terminal.export}</span>
          </button>

          <button
            onClick={onClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-gray-600 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-all bg-surface shadow-panel active:scale-95"
            title={t.terminal.clear}
          >
            <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-rose-600" />
            <span>{t.terminal.clear}</span>
          </button>
        </div>
      </div>

      {/* Control & Filter Toolbar (Unified with Palette) */}
      <div className="p-3 rounded-xl bg-surface border border-surface-border shadow-panel flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 font-mono text-xs">
        {/* Level Filters */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {[
            { id: 'all', label: t.terminal.all, count: logs.length },
            { id: 'info', label: 'INFO', count: countInfo, badge: 'text-sky-700 bg-sky-50 border-sky-200' },
            { id: 'warn', label: 'WARN', count: countWarn, badge: 'text-amber-700 bg-amber-50 border-amber-200' },
            { id: 'error', label: 'ERROR', count: countError, badge: 'text-rose-700 bg-rose-50 border-rose-200' }
          ].map((tab) => {
            const isSelected = levelFilter === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setLevelFilter(tab.id as any)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all border ${
                  isSelected
                    ? 'bg-brand-subtle text-brand font-bold border-brand-border shadow-2xs'
                    : 'bg-surface-muted/60 text-gray-600 hover:text-foreground border-surface-border/60 hover:bg-surface-hover'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isSelected
                        ? 'bg-brand/15 text-brand'
                        : 'bg-surface-border text-gray-500'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Search & Auto-scroll */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.terminal.filterPlaceholder}
              className="w-full bg-background border border-surface-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30 transition-all shadow-2xs"
            />
          </div>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-all flex items-center gap-1.5 shrink-0 ${
              autoScroll
                ? 'bg-brand-subtle text-brand border-brand-border font-semibold shadow-2xs'
                : 'bg-surface border-surface-border text-gray-500 hover:text-foreground'
            }`}
            title={autoScroll ? t.terminal.follow : t.terminal.paused}
          >
            {autoScroll ? <ArrowDownCircle className="w-3.5 h-3.5 text-brand" /> : <PauseCircle className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{autoScroll ? t.terminal.follow : t.terminal.paused}</span>
          </button>
        </div>
      </div>

      {/* Terminal Display Container (Warm Charcoal / Parchment Dark Screen) */}
      <div className="flex-1 rounded-xl bg-[#1E1C1A] border border-[#38332E] shadow-panel overflow-hidden flex flex-col font-mono relative">
        {/* Terminal Header Bar */}
        <div className="h-8 border-b border-[#332E2A] bg-[#24211E] px-4 flex items-center justify-between text-[11px] text-[#A8A29E] select-none shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E06C75]/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#E5C07B]/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#98C379]/80 inline-block" />
            <span className="ml-2 font-mono text-[10px] text-[#8C827A] uppercase tracking-wider">
              rosetta-main-worker / stdout
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-[#8C827A]">
            <span>{`${t.terminal.showing}: ${filteredLogs.length} / ${logs.length}`}</span>
            <span>•</span>
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>HOOK ACTIVE</span>
            </span>
          </div>
        </div>

        {/* Terminal Content Lines */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-1.5 text-xs select-text leading-relaxed font-mono"
        >
          {filteredLogs.map((log) => {
            const date = new Date(log.timestamp)
            const timeStr = `${date.toTimeString().split(' ')[0]}.${String(date.getMilliseconds()).padStart(3, '0')}`

            let levelColor = 'text-sky-300 font-semibold'
            let rowHighlight = 'hover:bg-white/[0.04]'

            if (log.level === 'warn') {
              levelColor = 'text-amber-400 font-bold'
              rowHighlight = 'bg-amber-950/20 hover:bg-amber-950/30'
            } else if (log.level === 'error') {
              levelColor = 'text-rose-400 font-bold'
              rowHighlight = 'bg-rose-950/25 hover:bg-rose-950/35 border-l-2 border-rose-500'
            }

            return (
              <div
                key={log.id}
                className={`flex items-start gap-2.5 py-0.5 px-2 rounded-sm transition-colors font-mono ${rowHighlight}`}
              >
                {/* Timestamp */}
                <span className="text-[#8C827A] text-[11px] shrink-0 select-none">
                  {timeStr}
                </span>

                {/* Level Badge */}
                <span className={`text-[10px] uppercase font-bold shrink-0 w-11 ${levelColor}`}>
                  [{log.level}]
                </span>

                {/* Message Body */}
                <span className="flex-1 whitespace-pre-wrap break-all text-[#EDEAE5] text-xs">
                  {formatMessage(log.message)}
                </span>
              </div>
            )
          })}

          {filteredLogs.length === 0 && (
            <div className="py-24 flex flex-col items-center justify-center text-center text-[#786E65] space-y-2 select-none font-mono">
              <Terminal className="w-8 h-8 opacity-40 text-brand" />
              <p className="text-xs">
                {t.terminal.noLogs}
              </p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
