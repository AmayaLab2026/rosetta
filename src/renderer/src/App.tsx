import React, { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { Sidebar, TabType } from './components/Sidebar'
import { MirrorStudio } from './components/MirrorStudio'
import { Composer } from './components/Composer'
import { RulesManager } from './components/RulesManager'
import { AccountsManager } from './components/AccountsManager'
import { LogsView } from './components/LogsView'
import { Account, MirrorRule, MirrorLogItem } from '../../shared/types'
import { I18nProvider, useI18n } from './i18n'

function RosettaMain() {
  const [currentTab, setCurrentTab] = useState<TabType>('studio')
  const [engineRunning, setEngineRunning] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rules, setRules] = useState<MirrorRule[]>([])
  const [logs, setLogs] = useState<MirrorLogItem[]>([])

  const loadAll = async () => {
    try {
      if (!window.rosetta) return
      const [accs, rls, lgs, status] = await Promise.all([
        window.rosetta.getAccounts(),
        window.rosetta.getMirrorRules(),
        window.rosetta.getLogs(150),
        window.rosetta.getMirrorEngineStatus()
      ])
      setAccounts(accs || [])
      setRules(rls || [])
      setLogs(lgs || [])
      setEngineRunning(status?.running || false)
    } catch (e) {
      console.error('[App] Failed to load data:', e)
    }
  }

  useEffect(() => {
    loadAll()

    // Listen to real-time events from main process
    if (window.rosetta) {
      const unsubLog = window.rosetta.onLogAdded((newLog) => {
        setLogs((prev) => [newLog, ...prev])
      })
      const unsubStatus = window.rosetta.onStatusChanged((status) => {
        setEngineRunning(status.engineRunning)
      })

      return () => {
        unsubLog()
        unsubStatus()
      }
    }
    return undefined
  }, [])

  const handleToggleEngine = async () => {
    if (!window.rosetta) return
    if (engineRunning) {
      await window.rosetta.stopMirrorEngine()
      setEngineRunning(false)
    } else {
      const started = await window.rosetta.startMirrorEngine()
      if (!started) {
        alert('Could not start engine: Ensure Telegram account is connected and active.')
      } else {
        setEngineRunning(true)
      }
    }
  }

  const activeRulesCount = rules.filter((r) => r.enabled).length
  const activeAccountsCount = accounts.filter((a) => a.status === 'active').length

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground select-none font-sans">
      <Header
        engineRunning={engineRunning}
        onToggleEngine={handleToggleEngine}
        activeRulesCount={activeRulesCount}
        activeAccountsCount={activeAccountsCount}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          rulesCount={rules.length}
          accountsCount={accounts.length}
          logsCount={logs.length}
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

          {currentTab === 'composer' && <Composer accounts={accounts} />}

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
