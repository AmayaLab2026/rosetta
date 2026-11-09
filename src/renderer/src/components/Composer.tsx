import React, { useState, useEffect, useRef } from 'react'
import { Account, AppSettings } from '../../../shared/types'
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Layers,
  Image as ImageIcon,
  X,
  ExternalLink,
  Copy,
  Check,
  Zap,
  ArrowRight,
  UploadCloud,
  FileVideo,
  Bot,
  Settings
} from 'lucide-react'
import { useI18n } from '../i18n'

interface ComposerProps {
  accounts: Account[]
  onOpenLogs?: () => void
  onOpenBotSettings?: () => void
}

export const Composer: React.FC<ComposerProps> = ({ accounts, onOpenLogs, onOpenBotSettings }) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'

  const [text, setText] = useState('')
  const [mediaFiles, setMediaFiles] = useState<Array<{ dataBase64: string; name: string; type: string }>>([])
  const [splitThread, setSplitThread] = useState(true)

  // Multi-target selections: Twitter & Telegram
  const [sendToTwitter, setSendToTwitter] = useState(true)
  const [sendToTelegram, setSendToTelegram] = useState(true)
  const [botConfig, setBotConfig] = useState<{ token?: string; chatId?: string }>({})

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingStage, setSubmittingStage] = useState<string>('')
  const [elapsedSec, setElapsedSec] = useState<number>(0)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [resultItems, setResultItems] = useState<Array<{
    platform: 'twitter' | 'telegram'
    success: boolean
    url?: string
    error?: string
  }>>([])
  const [publishDuration, setPublishDuration] = useState<number | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const twitterAccounts = accounts.filter((a) => a.platform === 'twitter' && a.status === 'active')
  const activeTwitterAccount = twitterAccounts[0]

  // Load Bot settings for Telegram posting
  useEffect(() => {
    window.rosetta.getSettings?.().then((st) => {
      if (st) {
        setBotConfig({
          token: st.defaultBotToken,
          chatId: st.defaultBotChatId
        })
        // If bot is configured, enable telegram by default
        if (st.defaultBotToken && st.defaultBotChatId) {
          setSendToTelegram(true)
        } else {
          setSendToTelegram(false)
        }
      }
    }).catch(() => {})
  }, [])

  // Timer ticker during submission for instant feedback
  useEffect(() => {
    if (isSubmitting) {
      const start = Date.now()
      setElapsedSec(0)
      timerRef.current = setInterval(() => {
        setElapsedSec(Number(((Date.now() - start) / 1000).toFixed(1)))
      }, 100)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isSubmitting])

  // Twitter char calculation (CJK = 2, Latin = 1, URL = 23)
  const calculateTwitterChars = (str: string): number => {
    const clean = str.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23))
    let count = 0
    for (const ch of clean) {
      const code = ch.charCodeAt(0)
      if (code >= 0x4e00 && code <= 0x9fff) {
        count += 2
      } else {
        count += 1
      }
    }
    return count
  }

  const charCount = calculateTwitterChars(text)
  const isOverflow = charCount > 280
  const willThread = isOverflow && splitThread
  const charPercent = Math.min(100, Math.round((charCount / 280) * 100))

  // Thread chunk calculator preview
  const previewChunks = React.useMemo(() => {
    if (!willThread || !text.trim()) return []
    const words = text.split('\n\n')
    const chunks: string[] = []
    let curr = ''
    for (const w of words) {
      if (!curr) curr = w
      else if (calculateTwitterChars(`${curr}\n\n${w}`) <= 265) curr += `\n\n${w}`
      else {
        chunks.push(curr)
        curr = w
      }
    }
    if (curr) chunks.push(curr)
    return chunks.map((c, i) => `${c} (${i + 1}/${chunks.length})`)
  }, [text, willThread])

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
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/') || f.type.startsWith('video/')
      )
      processFileList(files)
    }
  }

  const handlePublish = async () => {
    if ((!text.trim() && mediaFiles.length === 0)) return
    if (!sendToTwitter && !sendToTelegram) return

    setIsSubmitting(true)
    setResultItems([])
    setPublishDuration(null)
    setSubmittingStage(mediaFiles.length > 0 ? `正在并发上传 ${mediaFiles.length} 项媒体附件...` : '正在调度跨平台聚合发布...')

    const publishStart = Date.now()

    try {
      const targets: Array<{ platform: 'twitter' | 'telegram'; accountId: string }> = []

      if (sendToTwitter && activeTwitterAccount) {
        targets.push({ platform: 'twitter', accountId: activeTwitterAccount.id })
      }

      if (sendToTelegram) {
        targets.push({
          platform: 'telegram',
          accountId: botConfig.chatId || 'default'
        })
      }

      const res = await window.rosetta.sendUnifiedPost({
        text,
        mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
        targets,
        options: { splitThreadIfLong: splitThread }
      })

      const totalDuration = Date.now() - publishStart
      setPublishDuration(totalDuration)

      if (res.results) {
        setResultItems(res.results)
      }

      if (res.success) {
        setText('')
        setMediaFiles([])
      }
    } catch (err: any) {
      setResultItems([
        {
          platform: 'twitter',
          success: false,
          error: err.message || '发布过程发生未处理异常'
        }
      ])
    } finally {
      setIsSubmitting(false)
      setSubmittingStage('')
    }
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const hasTargets = (sendToTwitter && activeTwitterAccount) || (sendToTelegram && botConfig.token && botConfig.chatId)

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto font-sans">
      {/* Title & Cross-platform Targets Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">{t.composer.title}</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-brand-subtle text-brand border border-brand-border/60">
              {isZh ? '聚合多端广播' : 'Cross-Platform Broadcast'}
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {isZh
              ? '支持单选或同时勾选推特与电报，实现一键图文/视频多平台瞬时分发'
              : 'Publish to Twitter, Telegram, or broadcast to both simultaneously'}
          </p>
        </div>

        {/* Destination Target Pills */}
        <div className="flex items-center gap-2 flex-wrap font-mono text-xs">
          {/* Target: Twitter */}
          <button
            type="button"
            onClick={() => setSendToTwitter(!sendToTwitter)}
            disabled={!activeTwitterAccount}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
              sendToTwitter && activeTwitterAccount
                ? 'bg-sky-50 text-sky-900 border-sky-300 shadow-2xs font-semibold ring-1 ring-sky-300/40'
                : 'bg-surface border-surface-border text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="w-4 h-4 rounded bg-black text-white flex items-center justify-center font-bold text-[10px]">𝕏</span>
            <span>{activeTwitterAccount ? `@${activeTwitterAccount.username}` : (isZh ? '推特未绑定' : 'X Unlinked')}</span>
            <span className={`w-2 h-2 rounded-full ${sendToTwitter && activeTwitterAccount ? 'bg-sky-500' : 'bg-gray-300'}`} />
          </button>

          {/* Target: Telegram Bot */}
          <button
            type="button"
            onClick={() => {
              if (!botConfig.token || !botConfig.chatId) {
                onOpenBotSettings?.()
              } else {
                setSendToTelegram(!sendToTelegram)
              }
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
              sendToTelegram && botConfig.token && botConfig.chatId
                ? 'bg-telegram-subtle text-telegram font-semibold border-telegram-border shadow-2xs ring-1 ring-telegram/30'
                : 'bg-surface border-surface-border text-gray-400 hover:text-gray-600'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-telegram" />
            <span>
              {botConfig.chatId
                ? `TG: ${botConfig.chatId}`
                : isZh
                ? '电报 (点击配置)'
                : 'TG (Setup)'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                sendToTelegram && botConfig.token && botConfig.chatId ? 'bg-telegram' : 'bg-gray-300'
              }`}
            />
          </button>

          {/* Both Quick Switch */}
          <button
            type="button"
            onClick={() => {
              const enableBoth = !sendToTwitter || !sendToTelegram
              setSendToTwitter(enableBoth)
              setSendToTelegram(enableBoth)
            }}
            className="px-2 py-1.5 rounded-lg border border-surface-border bg-surface hover:bg-surface-hover text-gray-600 hover:text-foreground text-[11px] transition-colors"
            title="同时选中两个平台"
          >
            {isZh ? '两端同步' : 'Both'}
          </button>
        </div>
      </div>

      {/* Editor Box Container with Drag and Drop */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl bg-surface border transition-all p-4 shadow-panel space-y-4 relative ${
          isDragging
            ? 'border-brand ring-2 ring-brand/20 bg-brand-subtle/20'
            : 'border-surface-border hover:border-gray-300'
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-brand-subtle/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-20 rounded-xl border-2 border-dashed border-brand text-brand font-mono text-xs">
            <UploadCloud className="w-8 h-8 animate-bounce" />
            <span className="font-semibold text-sm">释放文件以添加为广播多媒体附件</span>
            <span className="text-[11px] opacity-80">支持批量图片 (JPG/PNG/WebP) 与视频 (MP4/WebM)</span>
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.composer.placeholder}
          rows={6}
          disabled={isSubmitting}
          className="w-full bg-background/40 border border-surface-border rounded-lg p-3.5 text-sm text-foreground placeholder-gray-400 focus:outline-hidden focus:border-brand focus:ring-1 focus:ring-brand/30 focus:bg-surface transition-all resize-none leading-relaxed font-sans"
        />

        {/* Media Attachments Preview Grid */}
        {mediaFiles.length > 0 && (
          <div className="space-y-2 pt-1 font-mono">
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>已选媒体附件 ({mediaFiles.length}/10)</span>
              <button
                type="button"
                onClick={() => setMediaFiles([])}
                className="text-gray-400 hover:text-rose-600 transition-colors"
              >
                清空附件
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

        {/* Live Submitting Progress Bar */}
        {isSubmitting && (
          <div className="p-3 rounded-lg bg-amber-50/80 border border-amber-200 text-amber-900 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                <span>{submittingStage || t.composer.publishing}</span>
              </span>
              <span className="text-amber-700 font-semibold">{elapsedSec}s</span>
            </div>
            <div className="w-full h-1 bg-amber-200/50 rounded-full overflow-hidden relative">
              <div className="absolute inset-0 animate-shimmer" />
            </div>
          </div>
        )}

        {/* Status / Character Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-surface-border">
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            {/* Media Attachment Upload Button */}
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border hover:border-gray-400 bg-surface text-gray-700 hover:text-foreground cursor-pointer text-xs font-mono transition-all shadow-2xs hover:bg-surface-hover active:scale-95">
              <ImageIcon className="w-3.5 h-3.5 text-brand" />
              <span>添加附件 ({mediaFiles.length}/10)</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={mediaFiles.length >= 10 || isSubmitting}
              />
            </label>

            {/* Character meter */}
            <div className="flex items-center gap-2 bg-surface-muted/60 px-2.5 py-1 rounded-md border border-surface-border/60">
              <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    charCount > 280
                      ? 'bg-rose-500'
                      : charCount > 240
                      ? 'bg-amber-500'
                      : 'bg-brand'
                  }`}
                  style={{ width: `${charPercent}%` }}
                />
              </div>
              <span
                className={`font-semibold text-xs ${
                  charCount > 280
                    ? willThread
                      ? 'text-brand'
                      : 'text-rose-600 font-bold'
                    : 'text-gray-700'
                }`}
              >
                {charCount}
              </span>
              <span className="text-gray-400 text-[11px]">/ 280</span>
            </div>

            {charCount > 280 && sendToTwitter && (
              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={splitThread}
                  onChange={(e) => setSplitThread(e.target.checked)}
                  className="rounded border-surface-border text-brand focus:ring-brand"
                />
                <span className="flex items-center gap-1 text-brand font-medium">
                  <Layers className="w-3.5 h-3.5" />
                  <span>{t.composer.autoThread} ({previewChunks.length} {t.composer.tweets})</span>
                </span>
              </label>
            )}
          </div>

          <button
            onClick={handlePublish}
            disabled={
              isSubmitting ||
              (!text.trim() && mediaFiles.length === 0) ||
              !hasTargets
            }
            className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-glow-terracotta active:scale-[0.98]"
          >
            <Send className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
            <span>
              {isSubmitting
                ? `发布中 (${elapsedSec}s)...`
                : sendToTwitter && sendToTelegram
                ? (isZh ? '一键同时发布至推特与电报' : 'Broadcast to X & Telegram')
                : sendToTelegram
                ? (isZh ? '发布至 Telegram 频道' : 'Publish to Telegram')
                : t.composer.broadcastBtn}
            </span>
          </button>
        </div>
      </div>

      {/* Multi-Target Result Cards */}
      {resultItems.length > 0 && (
        <div className="space-y-2.5 font-mono text-xs">
          {resultItems.map((item, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-panel transition-all ${
                item.success
                  ? 'bg-emerald-50/90 text-emerald-900 border-emerald-300'
                  : 'bg-rose-50/90 text-rose-900 border-rose-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {item.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <div>
                  <span className="font-bold mr-2 uppercase">
                    [{item.platform === 'telegram' ? 'Telegram' : 'X (Twitter)'}]
                  </span>
                  <span>{item.success ? (isZh ? '发布成功' : 'Published Successfully') : item.error}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                {item.url && (
                  <>
                    <button
                      type="button"
                      onClick={() => copyUrl(item.url!)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors text-[11px]"
                      title="复制链接"
                    >
                      {copiedLink ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedLink ? '已复制' : '复制链接'}</span>
                    </button>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 px-3 py-1 rounded bg-brand text-white hover:bg-brand-hover font-semibold text-[11px] transition-all shadow-2xs"
                    >
                      <span>{item.platform === 'telegram' ? '在 Telegram 查看' : t.composer.openOnX}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}

          {publishDuration && (
            <div className="flex items-center justify-between text-[11px] text-gray-500 px-1">
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <Zap className="w-3 h-3" />
                <span>总耗时: {publishDuration < 1000 ? `${publishDuration}ms` : `${(publishDuration / 1000).toFixed(2)}s`}</span>
              </span>

              {onOpenLogs && (
                <button
                  type="button"
                  onClick={onOpenLogs}
                  className="text-gray-600 hover:text-foreground underline flex items-center gap-1"
                >
                  <span>查看活动流水</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Thread Split Preview Sequence */}
      {previewChunks.length > 1 && sendToTwitter && (
        <div className="rounded-xl bg-surface border border-surface-border p-4 space-y-3 shadow-panel font-mono">
          <div className="flex items-center justify-between text-xs text-gray-700">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-brand" />
              <span className="font-semibold uppercase tracking-wider">{t.composer.threadPreview}</span>
            </div>
            <span className="text-[11px] text-gray-500">共 {previewChunks.length} 条推文串接</span>
          </div>

          <div className="space-y-2.5">
            {previewChunks.map((chunk, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-surface-muted/50 border border-surface-border text-xs text-gray-800 whitespace-pre-wrap relative pl-9 surface-hover-card"
              >
                <span className="absolute left-3 top-3 text-[10px] text-brand font-bold bg-brand-subtle px-1 rounded border border-brand-border/40">
                  #{idx + 1}
                </span>
                <span className="font-sans text-xs leading-relaxed text-foreground/90">{chunk}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
