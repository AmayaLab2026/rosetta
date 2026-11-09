import React, { useState, useEffect } from 'react'
import { TelegramBotPostItem, Account } from '../../../shared/types'
import {
  Bot,
  Send,
  Trash2,
  ExternalLink,
  Image as ImageIcon,
  X,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  FileVideo,
  Radio,
  UploadCloud,
  Hash,
  ShieldCheck,
  KeyRound,
  Layers,
  RotateCcw
} from 'lucide-react'
import { useI18n } from '../i18n'

interface TelegramBotStudioProps {
  accounts: Account[]
}

export const TelegramBotStudio: React.FC<TelegramBotStudioProps> = ({ accounts }) => {
  const { language } = useI18n()
  const isZh = language === 'zh'

  const [mode, setMode] = useState<'botToken' | 'mtproto'>('botToken')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [text, setText] = useState('')
  const [mediaFiles, setMediaFiles] = useState<Array<{ dataBase64: string; name: string; type: string }>>([])
  const [isSending, setIsSending] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [posts, setPosts] = useState<TelegramBotPostItem[]>([])
  const [resultMsg, setResultMsg] = useState<{ type: 'success' | 'error'; text: string; url?: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Quick manual delete state
  const [showManualDelete, setShowManualDelete] = useState(false)
  const [manualChatId, setManualChatId] = useState('')
  const [manualMsgId, setManualMsgId] = useState('')
  const [manualDeleting, setManualDeleting] = useState(false)
  const [manualResult, setManualResult] = useState<{ success: boolean; msg: string } | null>(null)

  const tgMtprotoAccount = accounts.find((a) => a.platform === 'telegram' && a.status === 'active')

  // Load saved default Bot Token & Chat ID from settings + history posts
  useEffect(() => {
    window.rosetta.getSettings?.().then((st) => {
      if (st) {
        if (st.defaultBotToken) setBotToken(st.defaultBotToken)
        if (st.defaultBotChatId) {
          setChatId(st.defaultBotChatId)
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
      console.warn('[TelegramBotStudio] Failed to load bot posts:', e)
    }
  }

  const handleSaveDefaultToken = async (token: string, chat: string) => {
    try {
      await window.rosetta.saveSettings?.({
        defaultBotToken: token.trim() || undefined,
        defaultBotChatId: chat.trim() || undefined
      })
    } catch {
      // ignore
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatId.trim()) return
    if (!text.trim() && mediaFiles.length === 0) return

    if (mode === 'botToken' && !botToken.trim()) {
      setResultMsg({ type: 'error', text: isZh ? '请先填写 Telegram 机器人 Token' : 'Please provide Telegram Bot Token' })
      return
    }

    setIsSending(true)
    setResultMsg(null)

    // Save preferences silently
    handleSaveDefaultToken(botToken, chatId)

    try {
      const res = await window.rosetta.sendTelegramBotPost({
        chatId: chatId.trim(),
        text: text.trim(),
        botToken: mode === 'botToken' ? botToken.trim() : undefined,
        useMtproto: mode === 'mtproto',
        mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined
      })

      if (res.success) {
        setResultMsg({
          type: 'success',
          text: isZh ? `消息已成功通过机器人发布至 ${chatId} (ID: #${res.messageId})` : `Message posted successfully to ${chatId} (#${res.messageId})`,
          url: res.postUrl
        })
        setText('')
        setMediaFiles([])
        loadPosts()
      } else {
        setResultMsg({
          type: 'error',
          text: res.error || (isZh ? '机器人发布消息失败，请检查 Token 与目标频道权限' : 'Failed to send message via bot')
        })
      }
    } catch (err: any) {
      setResultMsg({
        type: 'error',
        text: err?.message || 'Execution error'
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleDeletePost = async (item: TelegramBotPostItem) => {
    const confirmText = isZh
      ? `确定要从 ${item.chatId} 撤回/删除消息 #${item.messageId} 吗？`
      : `Revoke/delete message #${item.messageId} from ${item.chatId}?`
    if (!window.confirm(confirmText)) return

    setDeletingId(item.id)
    try {
      const res = await window.rosetta.deleteTelegramBotPost({
        chatId: item.chatId,
        messageId: item.messageId,
        botToken: mode === 'botToken' ? botToken.trim() : undefined,
        useMtproto: mode === 'mtproto'
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
      setManualResult({ success: false, msg: isZh ? '消息 ID 必须是数字' : 'Message ID must be a number' })
      return
    }

    setManualDeleting(true)
    setManualResult(null)

    try {
      const res = await window.rosetta.deleteTelegramBotPost({
        chatId: manualChatId.trim(),
        messageId: msgIdNum,
        botToken: mode === 'botToken' ? botToken.trim() : undefined,
        useMtproto: mode === 'mtproto'
      })

      if (res.success) {
        setManualResult({
          success: true,
          msg: isZh ? `成功在 ${manualChatId} 删除了消息 #${msgIdNum}` : `Deleted message #${msgIdNum} in ${manualChatId}`
        })
        setManualMsgId('')
        loadPosts()
      } else {
        setManualResult({
          success: false,
          msg: res.error || (isZh ? '删除失败，请核对消息是否存在或机器人是否有管理员删帖权限' : 'Delete failed')
        })
      }
    } catch (err: any) {
      setManualResult({ success: false, msg: err?.message || 'Error' })
    } finally {
      setManualDeleting(false)
    }
  }

  const handleClearHistory = async () => {
    if (window.confirm(isZh ? '清空本地机器人发帖历史记录？（不会删除 Telegram 频道上的消息）' : 'Clear local bot post history?')) {
      await window.rosetta.clearTelegramBotPosts?.()
      setPosts([])
    }
  }

  const copyText = (key: string, val: string) => {
    navigator.clipboard.writeText(val)
    setCopiedId(key)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-foreground font-mono tracking-tight flex items-center gap-2">
              <Bot className="w-4 h-4 text-brand" />
              <span>{isZh ? 'Telegram 机器人控制台' : 'Telegram Bot Studio'}</span>
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-brand-subtle text-brand border border-brand-border/60">
              {mode === 'botToken' ? 'Bot API 引擎' : 'MTProto 原生引擎'}
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {isZh
              ? '通过电报 Bot 发送并管理频道/群组消息，支持图文相册、视频直传与远程一键撤回'
              : 'Directly publish and revoke channel/group messages with full photo, video album, and deletion controls'}
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
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

          {posts.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="p-1.5 rounded-lg border border-surface-border bg-surface hover:bg-rose-50 hover:text-rose-600 text-gray-400 transition-colors shadow-2xs"
              title={isZh ? '清空本地发帖记录' : 'Clear History'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Manual Delete Drawer (Optional) */}
      {showManualDelete && (
        <form
          onSubmit={handleManualDelete}
          className="p-4 rounded-xl bg-surface border border-rose-200 shadow-panel space-y-3 font-mono text-xs animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-between pb-2 border-b border-rose-100">
            <span className="font-semibold text-rose-800 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isZh ? '指定频道与消息 ID 快速撤回' : 'Revoke Message by Exact ID'}</span>
            </span>
            <span className="text-[11px] text-gray-500">
              {isZh ? '机器人需拥有目标频道的管理员删帖权限' : 'Bot must have delete permissions in channel'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">{isZh ? '目标频道 ID 或 @username' : 'Target Chat ID'}</label>
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
              <label className="block text-[11px] text-gray-600 mb-1">{isZh ? '需要删除的消息 ID (数字)' : 'Message ID (number)'}</label>
              <input
                type="number"
                required
                placeholder="e.g. 1284"
                value={manualMsgId}
                onChange={(e) => setManualMsgId(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-rose-400"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            {manualResult && (
              <span className={`text-[11px] ${manualResult.success ? 'text-emerald-700' : 'text-rose-700'}`}>
                {manualResult.msg}
              </span>
            )}
            {!manualResult && <div />}

            <button
              type="submit"
              disabled={manualDeleting || !manualChatId.trim() || !manualMsgId.trim()}
              className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium disabled:opacity-50 transition-all shadow-2xs"
            >
              {manualDeleting ? (isZh ? '正在撤回...' : 'Deleting...') : (isZh ? '确认远程撤回' : 'Execute Delete')}
            </button>
          </div>
        </form>
      )}

      {/* Main Bot Composer Card */}
      <form
        onSubmit={handleSend}
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
            <span className="text-[11px] opacity-80">支持图片与高清 MP4/WebM 视频</span>
          </div>
        )}

        {/* Engine Mode Pill Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-border/80 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-[11px] uppercase tracking-wider">{isZh ? '发送驱动' : 'Driver'}:</span>
            <div className="inline-flex p-0.5 rounded-lg bg-surface-muted border border-surface-border">
              <button
                type="button"
                onClick={() => setMode('botToken')}
                className={`px-3 py-1 rounded-md transition-all text-xs ${
                  mode === 'botToken'
                    ? 'bg-surface text-brand font-bold shadow-2xs border border-brand-border/40'
                    : 'text-gray-600 hover:text-foreground'
                }`}
              >
                <span>Telegram Bot Token</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('mtproto')}
                className={`px-3 py-1 rounded-md transition-all text-xs flex items-center gap-1.5 ${
                  mode === 'mtproto'
                    ? 'bg-surface text-telegram font-bold shadow-2xs border border-telegram-border/40'
                    : 'text-gray-600 hover:text-foreground'
                }`}
              >
                <span>MTProto 客户端</span>
                <span className={`w-1.5 h-1.5 rounded-full ${tgMtprotoAccount ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              </button>
            </div>
          </div>

          {mode === 'mtproto' && (
            <span className="text-[11px] text-gray-500 flex items-center gap-1">
              <span>{isZh ? '当前 MTProto 账号' : 'Account'}:</span>
              <span className="text-telegram font-semibold">
                {tgMtprotoAccount ? tgMtprotoAccount.username || tgMtprotoAccount.displayName : (isZh ? '未登录(需在账号页连接)' : 'Not connected')}
              </span>
            </span>
          )}
        </div>

        {/* Credentials & Target Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          {mode === 'botToken' && (
            <div>
              <label className="block text-[11px] text-gray-600 mb-1 font-semibold">
                {isZh ? 'Bot Token (来自 @BotFather) *' : 'Bot Token *'}
              </label>
              <input
                type="password"
                required
                placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRstuVWXyz"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30"
              />
            </div>
          )}

          <div className={mode === 'mtproto' ? 'md:col-span-2' : ''}>
            <label className="block text-[11px] text-gray-600 mb-1 font-semibold">
              {isZh ? '目标频道 / 群组 ID 或 @username *' : 'Target Channel/Chat ID *'}
            </label>
            <input
              type="text"
              required
              placeholder="e.g. @my_channel or -1001987654321"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              className="w-full bg-background border border-surface-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
          </div>
        </div>

        {/* Message Input Box */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-mono text-gray-600 font-semibold">
            {isZh ? '消息正文 (Caption / Text)' : 'Message Content'}
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={isSending}
            placeholder={
              isZh
                ? '在此输入需要通过机器人发布至 Telegram 的内容，支持换行与 HTML/Markdown 标记格式...'
                : 'Write your message to publish via Telegram Bot...'
            }
            rows={5}
            className="w-full bg-background/50 border border-surface-border rounded-lg p-3.5 text-sm text-foreground placeholder-gray-400 focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30 focus:bg-surface transition-all resize-none leading-relaxed"
          />
        </div>

        {/* Media Attachments Preview Grid */}
        {mediaFiles.length > 0 && (
          <div className="space-y-2 pt-1 font-mono">
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>{isZh ? `已挂载媒体附件 (${mediaFiles.length}/10)` : `Attached Media (${mediaFiles.length}/10)`}</span>
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
              <span>{isZh ? `附加图片/视频 (${mediaFiles.length}/10)` : `Add Media (${mediaFiles.length}/10)`}</span>
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
                ? isZh ? '多媒体将自动作为原生相册 (MediaGroup) 整体发布' : 'Grouped as native Telegram album'
                : ''}
            </span>
          </div>

          <button
            type="submit"
            disabled={isSending || (!text.trim() && mediaFiles.length === 0) || !chatId.trim()}
            className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-glow-terracotta active:scale-[0.98]"
          >
            <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
            <span>{isSending ? (isZh ? '正在推送至 Telegram...' : 'Posting...') : (isZh ? '立即通过机器人发送' : 'Send via Bot')}</span>
          </button>
        </div>
      </form>

      {/* Result Alert */}
      {resultMsg && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-panel transition-all ${
            resultMsg.type === 'success'
              ? 'bg-emerald-50/90 text-emerald-900 border-emerald-300'
              : 'bg-rose-50/90 text-rose-900 border-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {resultMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{resultMsg.text}</span>
          </div>

          {resultMsg.url && (
            <a
              href={resultMsg.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1 rounded bg-brand text-white hover:bg-brand-hover font-semibold text-[11px] transition-all shadow-2xs self-end sm:self-auto"
            >
              <span>{isZh ? '在 Telegram 打开' : 'Open in Telegram'}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Sent Message Management & Revocation Stream */}
      <div className="rounded-xl bg-surface border border-surface-border p-5 space-y-4 shadow-panel font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {isZh ? `已发布消息管理 (${posts.length})` : `Sent Messages (${posts.length})`}
            </h3>
            <span className="text-[10px] text-gray-500">
              {isZh ? '支持一键撤回频道中已发送的任意消息' : 'Manage and revoke sent posts'}
            </span>
          </div>

          <button
            onClick={loadPosts}
            className="text-[11px] text-gray-500 hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{isZh ? '刷新' : 'Refresh'}</span>
          </button>
        </div>

        {posts.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 text-gray-400">
            <Bot className="w-8 h-8 opacity-40 text-brand" />
            <p className="text-xs">{isZh ? '暂无机器人发帖历史记录。在上方发帖后，消息将出现在此处并可随时撤回。' : 'No bot posts yet.'}</p>
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
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{isZh ? '频道在播' : 'ACTIVE'}</span>
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
                          onClick={() => handleDeletePost(item)}
                          disabled={deletingId === item.id}
                          className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 border border-rose-200 text-[11px] font-semibold transition-all disabled:opacity-50"
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
