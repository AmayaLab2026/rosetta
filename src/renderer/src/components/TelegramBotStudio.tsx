import React, { useState, useEffect } from 'react'
import { TelegramBotPostItem, Account } from '../../../shared/types'
import {
  Bot,
  Send,
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
  Hash,
  HelpCircle,
  ArrowRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  UploadCloud,
  Eye,
  EyeOff
} from 'lucide-react'
import { useI18n } from '../i18n'

interface TelegramBotStudioProps {
  accounts: Account[]
  onGoComposer?: () => void
}

export const TelegramBotStudio: React.FC<TelegramBotStudioProps> = ({ accounts, onGoComposer }) => {
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

  // Bot Post Composer Form State
  const [postText, setPostText] = useState('')
  const [targetChatId, setTargetChatId] = useState('')
  const [mediaFiles, setMediaFiles] = useState<Array<{ dataBase64: string; name: string; type: string }>>([])
  const [isSending, setIsSending] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; text: string; url?: string; messageId?: number } | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  // Posts history & management
  const [posts, setPosts] = useState<TelegramBotPostItem[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Manual Delete Tool
  const [showManualDelete, setShowManualDelete] = useState(false)
  const [manualChatId, setManualChatId] = useState('')
  const [manualMsgId, setManualMsgId] = useState('')
  const [manualDeleting, setManualDeleting] = useState(false)
  const [manualResult, setManualResult] = useState<{ success: boolean; msg: string } | null>(null)

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
          setTargetChatId(st.defaultBotChatId)
          setManualChatId(st.defaultBotChatId)
        }
      }
    }).catch(() => {})

    loadPosts()
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
        handleSaveCredentials(botToken, chatId)
      } else {
        setVerifyError(res?.error || (isZh ? 'Token 无效，请核对来自 @BotFather 的凭据' : 'Invalid Bot Token'))
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Token 验证失败')
    } finally {
      setIsVerifying(false)
    }
  }

  const processFileList = (files: File[]) => {
    const remainingSlots = 10 - mediaFiles.length
    for (const file of files.slice(0, remainingSlots)) {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        setMediaFiles((prev) => [
          ...prev,
          {
            dataBase64: result,
            name: file.name,
            type: file.type
          }
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    processFileList(Array.from(files))
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
      )
      processFileList(files)
    }
  }

  const handleBotPost = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = (targetChatId || chatId).trim()
    if (!target) {
      setSendResult({ type: 'error', text: isZh ? '请填写发布目标频道或群组 ID (@channel 或 -100...)' : 'Please specify target channel ID' })
      return
    }
    if (!postText.trim() && mediaFiles.length === 0) return
    if (!botToken.trim()) {
      setSendResult({ type: 'error', text: isZh ? '请先配置并保存 Telegram Bot Token' : 'Please configure Bot Token first' })
      return
    }

    setIsSending(true)
    setSendResult(null)

    // Ensure credentials memory
    handleSaveCredentials(botToken, target)

    try {
      const res = await window.rosetta.sendTelegramBotPost({
        chatId: target,
        text: postText.trim(),
        botToken: botToken.trim(),
        mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined
      })

      if (res.success) {
        setSendResult({
          type: 'success',
          text: isZh ? `消息已成功通过机器人发布至 ${target}！` : `Message posted successfully to ${target}!`,
          url: res.postUrl,
          messageId: res.messageId
        })
        setPostText('')
        setMediaFiles([])
        loadPosts()
      } else {
        setSendResult({
          type: 'error',
          text: res.error || (isZh ? '机器人发布消息失败，请检查频道管理员权限' : 'Failed to send message via bot')
        })
      }
    } catch (err: any) {
      setSendResult({ type: 'error', text: err?.message || 'Execution error' })
    } finally {
      setIsSending(false)
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

  const handleManualDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualChatId.trim() || !manualMsgId.trim()) return

    const msgIdNum = parseInt(manualMsgId.trim(), 10)
    if (isNaN(msgIdNum)) {
      setManualResult({ success: false, msg: isZh ? '消息 ID 必须是纯数字' : 'Message ID must be numeric' })
      return
    }

    setManualDeleting(true)
    setManualResult(null)

    try {
      const res = await window.rosetta.deleteTelegramBotPost({
        chatId: manualChatId.trim(),
        messageId: msgIdNum,
        botToken: botToken.trim() || undefined
      })

      if (res.success) {
        setManualResult({
          success: true,
          msg: isZh ? `成功在 ${manualChatId} 撤回了消息 #${msgIdNum}` : `Successfully revoked #${msgIdNum} in ${manualChatId}`
        })
        setManualMsgId('')
        loadPosts()
      } else {
        setManualResult({
          success: false,
          msg: res.error || (isZh ? '删除失败，请核对消息是否存在或 Bot 是否拥有管理员权限' : 'Failed to delete')
        })
      }
    } catch (err: any) {
      setManualResult({ success: false, msg: err?.message || 'Error' })
    } finally {
      setManualDeleting(false)
    }
  }

  const handleClearHistory = async () => {
    if (window.confirm(isZh ? '清空本地已发消息记录？（不会影响 Telegram 频道上的线上消息）' : 'Clear local records?')) {
      await window.rosetta.clearTelegramBotPosts?.()
      setPosts([])
    }
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-foreground font-mono tracking-tight flex items-center gap-2">
              <Bot className="w-4 h-4 text-brand" />
              <span>{isZh ? 'Telegram 机器人发帖与删帖工作台' : 'Telegram Bot Studio'}</span>
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
              官方 Bot API 服务端直连
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {isZh
              ? '直接使用你的 Telegram Bot 向频道发布图文、视频或相册消息，并支持全流程远程管理与一键删帖撤回'
              : 'Directly publish channel posts with photos, videos and native albums, and manage remote revocation'}
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs self-start sm:self-auto">
          <button
            onClick={() => setShowManualDelete(!showManualDelete)}
            className={`px-3 py-1.5 rounded-lg border transition-all shadow-2xs flex items-center gap-1.5 ${
              showManualDelete
                ? 'bg-rose-50 text-rose-700 border-rose-300 font-semibold'
                : 'bg-surface border-surface-border text-gray-700 hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            <span>{showManualDelete ? (isZh ? '收起指定删帖' : 'Close Tool') : (isZh ? '指定ID删帖' : 'ID Revoke Tool')}</span>
          </button>
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
                  将你刚刚创建的机器人以成员身份邀请添加到你想要发帖的公开或私有 Telegram 频道/群组中。
                </p>
              </div>

              <div className="p-3 rounded-lg bg-surface-muted/50 border border-surface-border/70 space-y-1">
                <div className="font-mono text-[11px] font-bold text-brand">步骤 3 · 设为管理员</div>
                <p className="text-[11px] text-gray-600">
                  在频道设置中把该机器人设置为<strong>管理员 (Administrator)</strong>，并确保赋予<strong>发布消息 (Post Messages)</strong> 与 <strong>删除消息 (Delete Messages)</strong>。
                </p>
              </div>

              <div className="p-3 rounded-lg bg-surface-muted/50 border border-surface-border/70 space-y-1">
                <div className="font-mono text-[11px] font-bold text-brand">步骤 4 · 填入凭证</div>
                <p className="text-[11px] text-gray-600">
                  在下方填入 Bot Token 与频道用户名（如 <code className="bg-white px-1 py-0.2 rounded border text-[10px]">@my_channel</code>），即可自动记忆并在全系统通用！
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
              {isZh ? '机器人服务端凭证记忆' : 'Bot Token & Channel Memory'}
            </h3>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            {savedToast && (
              <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px] animate-fade-in">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>凭证已持久存盘</span>
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
                Telegram Bot Token (来自 @BotFather) *
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
                setTargetChatId(e.target.value)
                setManualChatId(e.target.value)
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
              <span>凭证失焦自动存盘；在下方直接发帖或在聚合发帖器中均直接复用此凭证。</span>
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
              {isZh ? '立即保存' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Bot Dedicated Post Composer Card */}
      <form
        onSubmit={handleBotPost}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl bg-surface border transition-all p-5 shadow-panel space-y-4 relative ${
          isDragging
            ? 'border-brand ring-2 ring-brand/20 bg-brand-subtle/20'
            : 'border-surface-border hover:border-gray-300'
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-brand-subtle/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-20 rounded-xl border-2 border-dashed border-brand text-brand font-mono text-xs">
            <UploadCloud className="w-8 h-8 animate-bounce" />
            <span className="font-semibold text-sm">释放文件以添加为 Telegram 媒体</span>
            <span className="text-[11px] opacity-80">支持图片与高清 MP4/WebM 视频（自动相册打包）</span>
          </div>
        )}

        <div className="flex items-center justify-between pb-3 border-b border-surface-border/70">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-telegram" />
            <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-foreground">
              {isZh ? '电报机器人专属发帖台' : 'Post to Channel via Bot'}
            </h3>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-gray-500 text-[11px]">{isZh ? '发布目标' : 'Target'}:</span>
            <input
              type="text"
              required
              placeholder="e.g. @my_channel"
              value={targetChatId}
              onChange={(e) => setTargetChatId(e.target.value)}
              className="bg-background border border-surface-border rounded-md px-2.5 py-1 text-xs text-foreground font-mono w-44 focus:outline-hidden focus:border-brand"
            />
          </div>
        </div>

        {/* Message Input Box */}
        <div className="space-y-1.5">
          <textarea
            value={postText}
            onChange={(e) => setPostText(e.target.value)}
            disabled={isSending}
            placeholder={
              isZh
                ? '在此输入需要通过机器人发布至 Telegram 频道的内容，支持 HTML 格式（<b>粗体</b>、<i>斜体</i>、<a>链接</a>）与多行换行...'
                : 'Write your message to post to Telegram channel...'
            }
            rows={5}
            className="w-full bg-background/50 border border-surface-border rounded-lg p-3.5 text-sm text-foreground placeholder-gray-400 focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30 focus:bg-surface transition-all resize-none leading-relaxed font-sans"
          />
        </div>

        {/* Media Attachments Preview Grid */}
        {mediaFiles.length > 0 && (
          <div className="space-y-2 pt-1 font-mono">
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>{isZh ? `已添加媒体附件 (${mediaFiles.length}/10)` : `Attached Media (${mediaFiles.length}/10)`}</span>
              <button
                type="button"
                onClick={() => setMediaFiles([])}
                className="text-gray-400 hover:text-rose-600 transition-colors"
              >
                {isZh ? '清空所有附件' : 'Clear All'}
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
              {mediaFiles.map((f, i) => (
                <div
                  key={i}
                  className="relative group aspect-square rounded-lg overflow-hidden border border-surface-border bg-black/5 shadow-2xs hover:border-gray-400 transition-all"
                >
                  {f.type.startsWith('video/') ? (
                    <div className="w-full h-full relative">
                      <video src={f.dataBase64} className="w-full h-full object-cover" muted />
                      <span className="absolute bottom-1 left-1 px-1 py-0.2 bg-black/75 text-white text-[9px] font-mono rounded flex items-center gap-0.5">
                        <FileVideo className="w-2.5 h-2.5" />
                        <span>VIDEO</span>
                      </span>
                    </div>
                  ) : (
                    <img src={f.dataBase64} alt={f.name} className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => setMediaFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-rose-600 text-white rounded-full p-1 transition-colors opacity-90 group-hover:opacity-100 shadow-sm"
                    title="移除此项"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-surface-border">
          <div className="flex items-center gap-3 text-xs font-mono">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border hover:border-gray-400 bg-surface text-gray-700 hover:text-foreground cursor-pointer text-xs font-mono transition-all shadow-2xs hover:bg-surface-hover active:scale-95">
              <ImageIcon className="w-3.5 h-3.5 text-brand" />
              <span>{isZh ? `添加图片/视频 (${mediaFiles.length}/10)` : `Add Media (${mediaFiles.length}/10)`}</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={mediaFiles.length >= 10 || isSending}
              />
            </label>

            <span className="text-[11px] text-gray-500">
              {mediaFiles.length > 1
                ? isZh ? '多项媒体自动作为原生相册 (MediaGroup) 整体发布' : 'Grouped as native Telegram album'
                : ''}
            </span>
          </div>

          <button
            type="submit"
            disabled={isSending || (!postText.trim() && mediaFiles.length === 0) || !(targetChatId || chatId).trim()}
            className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-glow-terracotta active:scale-[0.98]"
          >
            <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
            <span>{isSending ? (isZh ? '正在推送至 Telegram...' : 'Posting...') : (isZh ? '通过机器人发布至频道' : 'Publish via Bot')}</span>
          </button>
        </div>
      </form>

      {/* Post Result Alert */}
      {sendResult && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-panel transition-all ${
            sendResult.type === 'success'
              ? 'bg-emerald-50/90 text-emerald-900 border-emerald-300'
              : 'bg-rose-50/90 text-rose-900 border-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {sendResult.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{sendResult.text}</span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {sendResult.url && (
              <>
                <button
                  type="button"
                  onClick={() => copyUrl(sendResult.url!)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors text-[11px]"
                >
                  {copiedLink ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedLink ? '已复制' : '复制链接'}</span>
                </button>
                <a
                  href={sendResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-3 py-1 rounded bg-brand text-white hover:bg-brand-hover font-semibold text-[11px] transition-all shadow-2xs"
                >
                  <span>{isZh ? '在 Telegram 查看' : 'View on Telegram'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual Remote Message Revocation Tool */}
      {showManualDelete && (
        <form
          onSubmit={handleManualDelete}
          className="p-4 rounded-xl bg-surface border border-rose-200/80 shadow-panel space-y-3 font-mono text-xs animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-between pb-2 border-b border-rose-100">
            <span className="font-semibold text-rose-800 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>{isZh ? '指定频道与 Message ID 远程撤回' : 'Remote Revoke by Message ID'}</span>
            </span>
            <span className="text-[11px] text-gray-500">
              {isZh ? '调用官方 Bot deleteMessage 接口撤回频道内指定消息' : 'Calls official Bot deleteMessage'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">{isZh ? '频道 ID 或 @username' : 'Channel ID'}</label>
              <input
                type="text"
                required
                placeholder="e.g. @my_channel or -100123456789"
                value={manualChatId}
                onChange={(e) => setManualChatId(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-rose-400"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">{isZh ? '消息 Message ID (纯数字)' : 'Message ID'}</label>
              <input
                type="number"
                required
                placeholder="e.g. 1528"
                value={manualMsgId}
                onChange={(e) => setManualMsgId(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-rose-400"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            {manualResult ? (
              <span className={`text-[11px] ${manualResult.success ? 'text-emerald-700' : 'text-rose-700'}`}>
                {manualResult.msg}
              </span>
            ) : (
              <div />
            )}

            <button
              type="submit"
              disabled={manualDeleting || !manualChatId.trim() || !manualMsgId.trim() || !botToken.trim()}
              className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium disabled:opacity-50 transition-all shadow-2xs active:scale-95"
            >
              {manualDeleting ? (isZh ? '正在撤回...' : 'Deleting...') : (isZh ? '执行远程删帖' : 'Execute Revoke')}
            </button>
          </div>
        </form>
      )}

      {/* Sent Message Management & Revocation Stream */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {isZh ? `机器人已发消息管理 (${posts.length})` : `Sent Message Management (${posts.length})`}
            </h3>
            <span className="text-[10px] text-gray-500">
              {isZh ? '支持一键撤回频道中已发送的任意消息' : 'One-click remote message deletion'}
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
                ? '暂无机器人发帖历史记录。在上方发帖后，消息将汇集于此处供随时撤回。'
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
