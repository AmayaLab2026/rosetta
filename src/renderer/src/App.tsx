import React, { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { Sidebar, TabType } from './components/Sidebar'
import { MirrorStudio } from './components/MirrorStudio'
import { Composer } from './components/Composer'
import { TelegramBotStudio } from './components/TelegramBotStudio'
import { RulesManager } from './components/RulesManager'
import { AccountsManager } from './components/AccountsManager'
import { LogsView } from './components/LogsView'
import { TerminalLogsView } from './components/TerminalLogsView'
import { SettingsView } from './components/SettingsView'
import { Account, MirrorRule, MirrorLogItem, TerminalLogItem } from '../../shared/types'
import { I18nProvider, useI18n } from './i18n'

function RosettaMain() {
  const [currentTab, setCurrentTab] = useState<TabType>('studio')
  const [engineRunning, setEngineRunning] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rules, setRules] = useState<MirrorRule[]>([])
  const [logs, setLogs] = useState<MirrorLogItem[]>([])
  const [terminalLogs, setTerminalLogs] = useState<TerminalLogItem[]>([])

  const loadAll = async () => {
    try {
      if (!window.rosetta) return
      const [accs, rls, lgs, status, tLogs] = await Promise.all([
        window.rosetta.getAccounts(),
        window.rosetta.getMirrorRules(),
        window.rosetta.getLogs(150),
        window.rosetta.getMirrorEngineStatus(),
        window.rosetta.getTerminalLogs?.() || Promise.resolve([])
      ])
      setAccounts(accs || [])
      setRules(rls || [])
      setLogs(lgs || [])
      if (tLogs) setTerminalLogs(tLogs)
      if (status) {
        setEngineRunning(Boolean(status.running || status.engineRunning))
      }
    } catch (e) {
      console.error('[App] Failed to load data:', e)
    }
  }

  const handleToggleEngine = async () => {
    try {
      if (engineRunning) {
        await window.rosetta.stopMirrorEngine()
      } else {
        await window.rosetta.startMirrorEngine()
      }
      const st = await window.rosetta.getMirrorEngineStatus()
      if (st) setEngineRunning(Boolean(st.running || st.engineRunning))
    } catch (e) {
      console.warn('[App] Failed to toggle engine:', e)
    }
  }

  useEffect(() => {
    loadAll()

    // Listen to real-time events from main process
    if (window.rosetta) {
      const unsubLog = window.rosetta.onLogAdded((newLog) => {
        setLogs((prev) => {
          const index = prev.findIndex((l) => l.id === newLog.id)
          if (index !== -1) {
            const copy = [...prev]
            copy[index] = newLog
            return copy
          }
          return [newLog, ...prev]
        })
        window.rosetta.getMirrorRules().then(setRules).catch(() => {})
      })
      const unsubTerminalLog = window.rosetta.onTerminalLogAdded?.((newTLog) => {
        setTerminalLogs((prev) => [...prev.slice(-999), newTLog])
      })
      const unsubStatus = window.rosetta.onStatusChanged((status) => {
        if (status) {
          setEngineRunning(Boolean(status.running || status.engineRunning))
        }
      })
      const unsubAccounts = window.rosetta.onAccountsUpdated?.((updatedAcc) => {
        setAccounts((prev) => {
          const idx = prev.findIndex((a) => a.id === updatedAcc.id)
          if (idx !== -1) {
            const copy = [...prev]
            copy[idx] = updatedAcc
            return copy
          }
          return [...prev, updatedAcc]
        })
      })

      // Auto-reload on window focus / visibility change
      const handleFocus = () => loadAll()
      const handleVisibility = () => {
        if (!document.hidden) loadAll()
      }
      window.addEventListener('focus', handleFocus)
      document.addEventListener('visibilitychange', handleVisibility)

      // Smart background polling fallback to guarantee zero sync lag without UI flicker
      const pollTimer = setInterval(() => {
        if (document.hidden) return
        window.rosetta.getMirrorEngineStatus().then((st) => {
          if (st) setEngineRunning(Boolean(st.running || st.engineRunning))
        }).catch(() => {})
        window.rosetta.getLogs(150).then((lgs) => {
          if (!lgs) return
          setLogs((prev) => {
            if (prev.length === lgs.length && prev[0]?.id === lgs[0]?.id && prev[0]?.status === lgs[0]?.status) {
              return prev
            }
            // Keep in-flight processing logs intact
            const processingMap = new Map(prev.filter((l) => l.status === 'processing').map((l) => [l.id, l]))
            return lgs.map((item) => processingMap.get(item.id) || item)
          })
        }).catch(() => {})
        window.rosetta.getMirrorRules().then((rls) => {
          if (rls) setRules(rls)
        }).catch(() => {})
      }, 3000)

      return () => {
        unsubLog()
        unsubTerminalLog?.()
        unsubStatus()
        unsubAccounts?.()
        window.removeEventListener('focus', handleFocus)
        document.removeEventListener('visibilitychange', handleVisibility)
        clearInterval(pollTimer)
      }
    }
    return undefined
  }, [])

  const activeRulesCount = rules.filter((r) => r.enabled).length
  const activeAccountsCount = accounts.filter((a) => a.status === 'active').length

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground select-none font-sans">
      <Header
        engineRunning={engineRunning}
        activeRulesCount={activeRulesCount}
        activeAccountsCount={activeAccountsCount}
        onToggleEngine={handleToggleEngine}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          rulesCount={rules.length}
          accountsCount={accounts.length}
          logsCount={logs.length}
          terminalLogsCount={terminalLogs.length}
        />

        <main className="flex-1 overflow-hidden bg-background">
          {currentTab === 'studio' && (
            <MirrorStudio
              engineRunning={engineRunning}
              rules={rules}
              accounts={accounts}
              logs={logs}
              onOpenRules={() => setCurrentTab('rules')}
              onOpenAccounts={() => setCurrentTab('accounts')}
            />
          )}

          {currentTab === 'composer' && (
            <Composer
              accounts={accounts}
              onOpenLogs={() => setCurrentTab('logs')}
              onOpenBotSettings={() => setCurrentTab('bot')}
            />
          )}

          {currentTab === 'bot' && (
            <TelegramBotStudio
              accounts={accounts}
              onGoComposer={() => setCurrentTab('composer')}
            />
          )}

          {currentTab === 'rules' && (
            <RulesManager
              rules={rules}
              accounts={accounts}
              onRuleUpdated={loadAll}
            />
          )}

          {currentTab === 'accounts' && (
            <AccountsManager
              accounts={accounts}
              onAccountUpdated={loadAll}
            />
          )}

          {currentTab === 'logs' && (
            <LogsView
              logs={logs}
              onClearLogs={async () => {
                await window.rosetta.clearLogs()
                setLogs([])
              }}
            />
          )}

          {currentTab === 'terminal' && (
            <TerminalLogsView
              logs={terminalLogs}
              onClearLogs={async () => {
                await window.rosetta.clearTerminalLogs()
                setTerminalLogs([])
              }}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              engineRunning={engineRunning}
              accounts={accounts}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <RosettaMain />
    </I18nProvider>
  )
}
