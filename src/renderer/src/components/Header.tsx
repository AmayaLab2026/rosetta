import React from 'react'
import { useI18n } from '../i18n'
import logoImg from '../assets/logo.png'

interface HeaderProps {
  engineRunning: boolean
  activeRulesCount: number
  activeAccountsCount: number
  onToggleEngine?: () => void
}

export const Header: React.FC<HeaderProps> = ({
  engineRunning,
  activeRulesCount,
  activeAccountsCount,
  onToggleEngine
}) => {
  const { language, setLanguage, t } = useI18n()

  return (
    <header className="h-14 border-b border-surface-border bg-surface/90 backdrop-blur-md px-5 flex items-center justify-between select-none shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg overflow-hidden border border-surface-border shadow-2xs flex items-center justify-center bg-white shrink-0">
            <img src={logoImg} alt="Rosetta Logo" className="w-full h-full object-cover" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-foreground font-mono">
            Rosetta
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-muted text-gray-600 border border-surface-border shadow-2xs">
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
                ? 'bg-surface text-brand font-semibold shadow-2xs border border-brand-border/40'
                : 'text-gray-500 hover:text-foreground'
            }`}
          >
            <span>中文</span>
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2.5 py-0.5 rounded-full transition-all duration-200 text-xs font-medium flex items-center gap-1 ${
              language === 'en'
                ? 'bg-surface text-brand font-semibold shadow-2xs border border-brand-border/40'
                : 'text-gray-500 hover:text-foreground'
            }`}
          >
            <span>EN</span>
          </button>
        </div>

        {/* Engine Always-On Status Badge (Interactive toggle & sync) */}
        <button
          onClick={onToggleEngine}
          title={
            engineRunning
              ? language === 'zh'
                ? '点击暂停/停止电报镜像引擎'
                : 'Click to pause mirror engine'
              : language === 'zh'
              ? '点击立即启动电报镜像引擎'
              : 'Click to start mirror engine'
          }
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border shadow-2xs transition-all cursor-pointer active:scale-95 ${
            engineRunning
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100/80 hover:border-emerald-400'
              : 'bg-surface-muted text-gray-600 border-surface-border hover:bg-gray-200/80 hover:border-gray-400'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {engineRunning && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                engineRunning ? 'bg-emerald-600' : 'bg-gray-400'
              }`}
            />
          </span>
          <span>
            {engineRunning
              ? language === 'zh'
                ? '引擎就绪·实时监听中'
                : 'Engine Active & Listening'
              : language === 'zh'
              ? '引擎未启动 (点击启动)'
              : 'Engine Idle (Click to Start)'}
          </span>
        </button>
      </div>
    </header>
  )
}
