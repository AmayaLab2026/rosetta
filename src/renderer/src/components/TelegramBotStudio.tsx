import React, { useState, useEffect } from 'react'
import { TelegramBotPostItem, Account } from '../../../shared/types'
import {
  Bot,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  FileVideo,
  Image as ImageIcon,
  RotateCcw,
  KeyRound,
  ShieldCheck,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  MessageSquare
} from 'lucide-react'
import { useI18n } from '../i18n'

interface TelegramBotStudioProps {
  accounts: Account[]
}

export const TelegramBotStudio: React.FC<TelegramBotStudioProps> = () => {
  const { language } = useI18n()
  const isZh = language === 'zh'

  // Credentials & Configuration
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [botProfile, setBotProfile] = useState<{ botName?: string; username?: string } | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [savedToast, setSavedToast] = useState(false)

  // Interactive Bot Polling Status
  const [interactiveStatus, setInteractiveStatus] = useState<{
    polling: boolean
    botUsername: string | null
    botFirstName: string | null
  }>({ polling: false, botUsername: null, botFirstName: null })

  // Posts history & management
  const [posts, setPosts] = useState<TelegramBotPostItem[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Tutorial Collapse state
  const [showTutorial, setShowTutorial] = useState(false)

  // Load saved credentials & posts history on mount
  useEffect(() => {
    window.rosetta.getSettings?.().then((st) => {
      if (st) {
        if (st.defaultBotToken) {
          setBotToken(st.defaultBotToken)
          // Automatically verify saved token in background
          window.rosetta.verifyTelegramBotToken?.(st.defaultBotToken).then((res) => {
            if (res?.valid) {
              setBotProfile({ botName: res.botName, username: res.username })
            }
          }).catch(() => {})
        }
        if (st.defaultBotChatId) {
          setChatId(st.defaultBotChatId)
        }
      }
    }).catch(() => {})

    loadPosts()

    const fetchInteractiveStatus = () => {
      window.rosetta.getTelegramBotInteractiveStatus?.().then((res) => {
        if (res) setInteractiveStatus(res)
      }).catch(() => {})
    }
    fetchInteractiveStatus()
    const timer = setInterval(fetchInteractiveStatus, 3000)
    return () => clearInterval(timer)
  }, [])

  const loadPosts = async () => {
    try {
      const items = await window.rosetta.getTelegramBotPosts?.()
      if (items) setPosts(items)
    } catch (e) {
      console.warn('[TelegramBotStudio] Failed to load posts:', e)
    }
  }

  const handleSaveCredentials = async (tokenVal = botToken, chatVal = chatId) => {
    try {
      await window.rosetta.saveSettings?.({
        defaultBotToken: tokenVal.trim() || undefined,
        defaultBotChatId: chatVal.trim() || undefined
      })
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 2000)
      window.rosetta.getTelegramBotInteractiveStatus?.().then((res) => {
        if (res) setInteractiveStatus(res)
      }).catch(() => {})
    } catch (e) {
      console.warn('[TelegramBotStudio] Save error:', e)
    }
  }

  const handleTestToken = async () => {
    if (!botToken.trim()) return
    setIsVerifying(true)
    setVerifyError(null)
    setBotProfile(null)

    try {
      const res = await window.rosetta.verifyTelegramBotToken?.(botToken.trim())
      if (res?.valid) {
        setBotProfile({ botName: res.botName, username: res.username })
        await handleSaveCredentials(botToken, chatId)
      } else {
        setVerifyError(res?.error || (isZh ? 'Token 无效，请核对来自 @BotFather 的凭据' : 'Invalid Bot Token'))
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Token 验证失败')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleDeletePost = async (item: TelegramBotPostItem) => {
    const confirmText = isZh
      ? `确定要通过 Bot API 从 ${item.chatId} 撤回/删除消息 #${item.messageId} 吗？`
      : `Revoke message #${item.messageId} from ${item.chatId} via Bot API?`
    if (!window.confirm(confirmText)) return

    setDeletingId(item.id)
    try {
      const res = await window.rosetta.deleteTelegramBotPost({
        chatId: item.chatId,
        messageId: item.messageId,
        botToken: botToken.trim() || undefined
      })

      if (res.success) {
        loadPosts()
      } else {
        alert(isZh ? `撤回失败: ${res.error}` : `Failed to delete: ${res.error}`)
      }
    } catch (err: any) {
      alert(err.message || 'Delete operation failed')
    } finally {
      setDeletingId(null)
    }
  }

  const handleClearHistory = async () => {
    if (window.confirm(isZh ? '清空本地已发消息记录？（不会影响 Telegram 频道上的线上消息）' : 'Clear local records?')) {
      await window.rosetta.clearTelegramBotPosts?.()
      setPosts([])
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto font-sans">
      {/* Top Header without extra buttons */}
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold text-foreground font-mono tracking-tight flex items-center gap-2">
            <Bot className="w-4 h-4 text-brand" />
            <span>{isZh ? 'Telegram 机器人中枢 (交互发帖 & 删帖)' : 'Telegram Bot Studio'}</span>
          </h2>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
            官方 Bot API 交互会话
          </span>
        </div>
        <p className="text-xs text-gray-500 font-mono mt-0.5">
          {isZh
            ? '用户可在 Telegram 私聊中直接与机器人沟通发帖至推特和频道，并提供远程管理与删帖撤回'
            : 'Interact with bot in private chat to post to Twitter/channel, manage revocation and credentials'}
        </p>
      </div>

      {/* Interactive Telegram Bot Controller Card */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 shadow-panel space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-telegram-subtle border border-telegram-border/60 flex items-center justify-center text-telegram font-bold text-lg shadow-2xs">
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">
                  {interactiveStatus.botUsername ? `@${interactiveStatus.botUsername}` : (isZh ? '电报交互发帖机器人' : 'Telegram Interactive Bot')}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold flex items-center gap-1.5 ${
                  interactiveStatus.polling
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                    : 'bg-surface-muted text-gray-500 border border-surface-border'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${interactiveStatus.polling ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                  <span>{interactiveStatus.polling ? (isZh ? '私聊会话就绪·正在监听' : 'Chat Polling Active') : (isZh ? '未启动' : 'Idle')}</span>
                </span>
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                {isZh
                  ? '在手机或桌面 Telegram 私聊中发送 /start，即可直接交互发帖至推特与电报频道'
                  : 'Send /start in private chat with this bot to publish interactively'}
              </p>
            </div>
          </div>

          {interactiveStatus.botUsername && (
            <a
              href={`https://t.me/${interactiveStatus.botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-telegram hover:bg-telegram/90 text-white font-mono text-xs font-semibold shadow-2xs transition-all active:scale-95 self-start sm:self-auto"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{isZh ? '打开 Telegram 私聊发帖' : 'Open Chat in Telegram'}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Workflow Steps Preview */}
        <div className="pt-2 border-t border-surface-border/60 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] font-mono text-gray-600">
          <div className="p-2.5 rounded-lg bg-surface-muted/40 border border-surface-border/60 space-y-0.5">
            <span className="font-bold text-telegram block">1. 发送 /start</span>
            <span className="text-gray-500 text-[10px]">在 Telegram 私聊唤起机器人，点击选项卡选择发布目标 (Twitter / 频道 / 两端)</span>
          </div>
          <div className="p-2.5 rounded-lg bg-surface-muted/40 border border-surface-border/60 space-y-0.5">
            <span className="font-bold text-telegram block">2. 发送文字或媒体</span>
            <span className="text-gray-500 text-[10px]">直接发送文本或上传图片、视频（自动相册打包），机器人暂存并展示预览</span>
          </div>
          <div className="p-2.5 rounded-lg bg-surface-muted/40 border border-surface-border/60 space-y-0.5">
            <span className="font-bold text-telegram block">3. 确认并返回链接</span>
            <span className="text-gray-500 text-[10px]">点击【确认发布】，机器人即刻执行分发并回复直达推文与频道链接</span>
          </div>
        </div>
      </div>

      {/* Tutorial Card: t.me/BotFather Guide */}
      <div className="rounded-xl bg-surface border border-brand-border/60 p-4 shadow-panel space-y-3">
        <div
          onClick={() => setShowTutorial(!showTutorial)}
          className="flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2 text-xs font-mono font-semibold text-brand">
            <HelpCircle className="w-4 h-4 text-brand" />
            <span>{isZh ? '📖 官方机器人 (@BotFather) 极速创建与频道配置指南' : 'Official Bot Creation & Channel Guide'}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-gray-500">
            <span>{showTutorial ? (isZh ? '收起教程' : 'Hide') : (isZh ? '展开教程' : 'Show Guide')}</span>
            {showTutorial ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>

        {showTutorial && (
          <div className="space-y-3 pt-2 border-t border-surface-border/60 text-xs text-gray-700 leading-relaxed font-sans">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-surface-muted/50 border border-surface-border/70 space-y-1">
                <div className="font-mono text-[11px] font-bold text-brand">步骤 1 · 获取 Token</div>
                <p className="text-[11px] text-gray-600">
                  在 Telegram 中打开{' '}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                    className="text-telegram font-semibold hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>@BotFather</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  ，发送 <code className="bg-white px-1 py-0.2 rounded border text-[10px]">/newbot</code>，按提示命名并复制生成的 HTTP API Token。
                </p>
              </div>

              <div className="p-3 rounded-lg bg-surface-muted/50 border border-surface-border/70 space-y-1">
                <div className="font-mono text-[11px] font-bold text-brand">步骤 2 · 拉入频道</div>
                <p className="text-[11px] text-gray-600">
                  将你刚刚创建的机器人以成员身份邀请添加到你想要同步广播的公开或私有 Telegram 频道/群组中。
                </p>
              </div>

              <div className="p-3 rounded-lg bg-surface-muted/50 border border-surface-border/70 space-y-1">
                <div className="font-mono text-[11px] font-bold text-brand">步骤 3 · 设为管理员</div>
                <p className="text-[11px] text-gray-600">
                  在频道设置中把该机器人设置为<strong>管理员 (Administrator)</strong>，并确保勾选<strong>发布消息 (Post Messages)</strong> 与 <strong>删除消息 (Delete Messages)</strong>。
                </p>
              </div>

              <div className="p-3 rounded-lg bg-surface-muted/50 border border-surface-border/70 space-y-1">
                <div className="font-mono text-[11px] font-bold text-brand">步骤 4 · 填入凭证</div>
                <p className="text-[11px] text-gray-600">
                  在下方填入 Bot Token 与频道用户名（如 <code className="bg-white px-1 py-0.2 rounded border text-[10px]">@my_channel</code>），即可自动记忆并开启私聊会话！
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 pt-1">
              <span>提示：私有频道如无公开用户名，可使用标准数字 ID 格式（如 -100123456789）。</span>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="text-telegram hover:underline font-semibold flex items-center gap-1"
              >
                <span>直达 @BotFather ➔</span>
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Bot Credentials & Memory Center Card */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 shadow-panel space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-surface-border/70">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand" />
            <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-foreground">
              {isZh ? '机器人服务端凭证记忆配置' : 'Bot Credentials Configuration'}
            </h3>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            {savedToast && (
              <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px] animate-fade-in">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>凭证已自动持久记忆</span>
              </span>
            )}
            {botProfile && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>{botProfile.botName} (@{botProfile.username})</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-600 font-semibold">
                Telegram Bot Token (HTTP API) *
              </label>
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-[10px]"
              >
                {showToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>{showToken ? (isZh ? '隐藏' : 'Hide') : (isZh ? '显示' : 'Show')}</span>
              </button>
            </div>
            <input
              type={showToken ? 'text' : 'password'}
              placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRstuVWXyz"
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value)
                setBotProfile(null)
              }}
              onBlur={() => handleSaveCredentials(botToken, chatId)}
              className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
          </div>

          <div>
            <label className="block text-[11px] text-gray-600 mb-1 font-semibold">
              {isZh ? '默认推送目标频道 ID 或 @username *' : 'Default Channel / Chat ID *'}
            </label>
            <input
              type="text"
              placeholder="e.g. @my_channel or -1001987654321"
              value={chatId}
              onChange={(e) => {
                setChatId(e.target.value)
              }}
              onBlur={() => handleSaveCredentials(botToken, chatId)}
              className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="text-[11px] font-mono text-gray-500">
            {verifyError && <span className="text-rose-600 font-semibold">验证失败: {verifyError}</span>}
            {!verifyError && (
              <span>凭证失焦自动存盘；机器人自动连接 Telegram Long Polling，接收私聊指令。</span>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={handleTestToken}
              disabled={isVerifying || !botToken.trim()}
              className="px-4 py-1.5 rounded-lg border border-surface-border bg-surface hover:bg-surface-hover text-gray-700 hover:text-foreground font-medium transition-all shadow-2xs disabled:opacity-50 active:scale-95"
            >
              {isVerifying ? (isZh ? '验证中...' : 'Verifying...') : (isZh ? '测试 Token 连通性' : 'Test Token')}
            </button>
            <button
              type="button"
              onClick={() => handleSaveCredentials(botToken, chatId)}
              className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium transition-all shadow-glow-terracotta active:scale-95"
            >
              {isZh ? '保存凭证配置' : 'Save Config'}
            </button>
          </div>
        </div>
      </div>

      {/* Sent Message Management & Revocation Stream */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {isZh ? `已发布消息管理 (${posts.length})` : `Sent Message Management (${posts.length})`}
            </h3>
            <span className="text-[10px] text-gray-500">
              {isZh ? '一键撤回频道中已发送的任意消息' : 'One-click remote message deletion'}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={loadPosts}
              className="text-[11px] text-gray-500 hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{isZh ? '刷新' : 'Refresh'}</span>
            </button>

            {posts.length > 0 && (
              <button
                type="button"
                onClick={handleClearHistory}
                className="p-1 rounded text-gray-400 hover:text-rose-600 transition-colors"
                title={isZh ? '清空本地记录' : 'Clear'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 text-gray-400">
            <Bot className="w-8 h-8 opacity-40 text-brand" />
            <p className="text-xs">
              {isZh
                ? '暂无已发消息记录。在 Telegram 私聊发帖或在「统一发帖器」发布后，消息将汇集于此处供随时撤回。'
                : 'No messages posted yet. Sent messages will be recorded here for one-click revocation.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((item) => {
              const isDel = item.status === 'deleted'
              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl bg-surface-muted/40 border transition-all space-y-2 text-xs shadow-2xs ${
                    isDel
                      ? 'border-gray-200 opacity-60 bg-gray-50'
                      : 'border-surface-border hover:border-gray-400 surface-hover-card'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-500 text-[11px]">
                        {new Date(item.sentAt).toLocaleTimeString()}
                      </span>
                      <span className="text-gray-300">•</span>
                      <span className="text-telegram font-bold bg-telegram-subtle px-1.5 py-0.5 rounded border border-telegram-border/50 text-[11px]">
                        {item.chatId}
                      </span>
                      <span className="text-gray-600 bg-surface px-1.5 py-0.5 rounded border border-surface-border text-[11px] font-semibold">
                        Msg #{item.messageId}
                      </span>

                      {item.mediaCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-600 bg-surface px-1.5 py-0.5 rounded border border-surface-border">
                          {item.mediaType === 'video' ? <FileVideo className="w-3 h-3 text-brand" /> : <ImageIcon className="w-3 h-3 text-brand" />}
                          <span>{item.mediaCount} 项媒体</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isDel ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-200 text-gray-600 border border-gray-300 font-semibold">
                          {isZh ? '已从频道撤回' : 'DELETED'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-300 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>{isZh ? '频道在线' : 'ACTIVE'}</span>
                        </span>
                      )}

                      {item.postUrl && (
                        <a
                          href={item.postUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand hover:underline flex items-center gap-1 text-[11px] font-semibold bg-brand-subtle px-2 py-0.5 rounded border border-brand-border/60 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>{isZh ? '直达' : 'Link'}</span>
                        </a>
                      )}

                      {!isDel && (
                        <button
                          type="button"
                          onClick={() => handleDeletePost(item)}
                          disabled={deletingId === item.id}
                          className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 border border-rose-200 text-[11px] font-semibold transition-all disabled:opacity-50 active:scale-95"
                          title="远程撤回/删除这条电报消息"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{deletingId === item.id ? (isZh ? '撤回中...' : 'Deleting...') : (isZh ? '撤回此帖' : 'Revoke')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Text preview */}
                  <div className="bg-surface p-2.5 rounded-lg border border-surface-border text-gray-800 text-[11px] whitespace-pre-wrap leading-relaxed select-text font-sans">
                    {item.text}
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
