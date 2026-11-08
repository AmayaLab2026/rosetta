import React from 'react'
import { Play, Square, Cpu, Globe } from 'lucide-react'
import { useI18n } from '../i18n'

interface HeaderProps {
  engineRunning: boolean
  onToggleEngine: () => void
  activeRulesCount: number
  activeAccountsCount: number
}

export const Header: React.FC<HeaderProps> = ({
  engineRunning,
  onToggleEngine,
  activeRulesCount,
  activeAccountsCount
}) => {
  const { language, setLanguage, t } = useI18n()

  return (
    <header className="h-14 border-b border-surface-border bg-surface/90 backdrop-blur-md px-5 flex items-center justify-between select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-brand flex items-center justify-center shadow-glow-terracotta">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-foreground font-mono">
            Rosetta
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-muted text-gray-600 border border-surface-border">
            {t.header.subtitle}
          </span>
        </div>

        <div className="h-4 w-[1px] bg-surface-border mx-2" />

        <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                activeAccountsCount > 0 ? 'bg-emerald-600' : 'bg-amber-500'
              }`}
            />
            {activeAccountsCount} {t.header.accounts}
          </span>
          <span className="text-surface-border">•</span>
          <span>
            {activeRulesCount} {t.header.activeRules}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Pill-shaped Language Toggle Switch */}
        <div className="inline-flex items-center p-0.5 rounded-full bg-surface-muted border border-surface-border shadow-inner font-mono text-xs">
          <button
            onClick={() => setLanguage('zh')}
            className={`px-2.5 py-0.5 rounded-full transition-all duration-200 text-xs font-medium flex items-center gap-1 ${
              language === 'zh'
                ? 'bg-surface text-brand font-semibold shadow-sm border border-brand-border/40'
                : 'text-gray-500 hover:text-foreground'
            }`}
          >
            <span>中文</span>
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2.5 py-0.5 rounded-full transition-all duration-200 text-xs font-medium flex items-center gap-1 ${
              language === 'en'
                ? 'bg-surface text-brand font-semibold shadow-sm border border-brand-border/40'
                : 'text-gray-500 hover:text-foreground'
            }`}
          >
            <span>EN</span>
          </button>
        </div>

        <button
          onClick={onToggleEngine}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all duration-150 ${
            engineRunning
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 shadow-sm'
              : 'bg-surface text-gray-700 hover:bg-surface-hover border border-surface-border shadow-panel'
          }`}
        >
          {engineRunning ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
              </span>
              <span>{t.header.engineActive}</span>
              <Square className="w-3 h-3 ml-1 fill-current opacity-70" />
            </>
          ) : (
            <>
              <Play className="w-3 h-3 fill-current text-gray-600" />
              <span>{t.header.startEngine}</span>
            </>
          )}
        </button>
      </div>
    </header>
  )
}
