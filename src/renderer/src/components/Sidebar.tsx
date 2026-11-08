import React from 'react'
import { Radio, Send, Sliders, Users, Terminal } from 'lucide-react'
import { useI18n } from '../i18n'

export type TabType = 'studio' | 'composer' | 'rules' | 'accounts' | 'logs'

interface SidebarProps {
  currentTab: TabType
  onSelectTab: (tab: TabType) => void
  rulesCount: number
  accountsCount: number
  logsCount: number
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  rulesCount,
  accountsCount,
  logsCount
}) => {
  const { t } = useI18n()

  const items: Array<{ id: TabType; label: string; icon: any; count?: number }> = [
    { id: 'studio', label: t.sidebar.studio, icon: Radio },
    { id: 'composer', label: t.sidebar.composer, icon: Send },
    { id: 'rules', label: t.sidebar.rules, icon: Sliders, count: rulesCount },
    { id: 'accounts', label: t.sidebar.accounts, icon: Users, count: accountsCount },
    { id: 'logs', label: t.sidebar.logs, icon: Terminal, count: logsCount }
  ]

  return (
    <aside className="w-56 border-r border-surface-border bg-surface-muted/60 flex flex-col justify-between py-4 select-none shrink-0">
      <div className="space-y-1 px-3">
        <div className="text-[11px] font-mono uppercase tracking-wider text-gray-500 px-3 py-1 font-semibold">
          {t.sidebar.workstation}
        </div>
        {items.map((item) => {
          const Icon = item.icon
          const isActive = currentTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-brand-subtle text-brand border border-brand-border font-semibold shadow-sm'
                  : 'text-gray-600 hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-brand' : 'text-gray-500'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {typeof item.count === 'number' && item.count > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    isActive ? 'bg-brand/15 text-brand font-semibold' : 'bg-surface-border text-gray-600'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="px-5 text-[11px] text-gray-500 font-mono space-y-1">
        <div className="flex items-center justify-between">
          <span>{t.sidebar.engineTitle}</span>
          <span className="text-gray-700 font-medium">GramJS + X Web</span>
        </div>
      </div>
    </aside>
  )
}
