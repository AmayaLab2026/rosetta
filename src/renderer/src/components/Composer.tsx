import React, { useState, useEffect, useRef } from 'react'
import { Account } from '../../../shared/types'
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
  FileVideo
} from 'lucide-react'
import { useI18n } from '../i18n'

interface ComposerProps {
  accounts: Account[]
  onOpenLogs?: () => void
}

export const Composer: React.FC<ComposerProps> = ({ accounts, onOpenLogs }) => {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [mediaFiles, setMediaFiles] = useState<Array<{ dataBase64: string; name: string; type: string }>>([])
  const [splitThread, setSplitThread] = useState(true)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingStage, setSubmittingStage] = useState<string>('')
  const [elapsedSec, setElapsedSec] = useState<number>(0)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [resultMsg, setResultMsg] = useState<{
    type: 'success' | 'error'
    text: string
    url?: string
    durationMs?: number
  } | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const twitterAccounts = accounts.filter((a) => a.platform === 'twitter' && a.status === 'active')

  // Auto select first twitter account if none selected
  useEffect(() => {
    if (selectedAccountIds.length === 0 && twitterAccounts.length > 0) {
      setSelectedAccountIds([twitterAccounts[0].id])
    }
  }, [twitterAccounts])

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
    const remainingSlots = 12 - mediaFiles.length
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
    if ((!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0) return
    setIsSubmitting(true)
    setResultMsg(null)
    setSubmittingStage(mediaFiles.length > 0 ? `正在并发上传 ${mediaFiles.length} 项附件...` : '正在签名并调度发布...')

    const publishStart = Date.now()

    try {
      const targets = selectedAccountIds.map((id) => ({
        platform: 'twitter' as const,
        accountId: id
      }))

      // Stage ticker for visual delight
      if (mediaFiles.length > 0) {
        setTimeout(() => {
          setSubmittingStage('正在动态计算 x-client-transaction-id...')
        }, 300)
      }

      const res = await window.rosetta.sendUnifiedPost({
        text,
        mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
        targets,
        options: { splitThreadIfLong: splitThread }
      })

      const totalDuration = Date.now() - publishStart

      if (res.success) {
        const firstSuccess = res.results.find((r) => r.success)
        setResultMsg({
          type: 'success',
          text: t.composer.publishSuccess,
          url: firstSuccess?.url,
          durationMs: totalDuration
        })
        setText('')
        setMediaFiles([])
      } else {
        const err = res.results.find((r) => r.error)?.error || '发布失败，请检查网络或账号状态'
        setResultMsg({ type: 'error', text: err, durationMs: totalDuration })
      }
    } catch (err: any) {
      setResultMsg({ type: 'error', text: err.message || '执行发布发生异常' })
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

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      {/* Title & Account Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">{t.composer.title}</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-brand-subtle text-brand border border-brand-border/60">
              极速直连
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{t.composer.desc}</p>
        </div>

        {/* Account selector pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {twitterAccounts.map((acc) => {
            const isSelected = selectedAccountIds.includes(acc.id)
            return (
              <button
                key={acc.id}
                onClick={() => {
                  setSelectedAccountIds(
                    isSelected
                      ? selectedAccountIds.filter((id) => id !== acc.id)
                      : [...selectedAccountIds, acc.id]
                  )
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${
                  isSelected
                    ? 'bg-brand-subtle text-brand border-brand-border shadow-2xs font-semibold ring-1 ring-brand/30'
                    : 'bg-surface border-surface-border text-gray-600 hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                {acc.avatarUrl ? (
                  <img src={acc.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0 shadow-2xs" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                )}
                <span>@{acc.username}</span>
              </button>
            )
          })}
          {twitterAccounts.length === 0 && (
            <span className="text-xs font-mono text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              {t.composer.noTwitterAcc}
            </span>
          )}
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
            <span className="font-semibold text-sm">释放文件以添加为推文多媒体附件</span>
            <span className="text-[11px] opacity-80">支持批量图片 (JPG/PNG/WebP) 与视频 (MP4/WebM)</span>
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.composer.placeholder}
          rows={6}
          disabled={isSubmitting}
          className="w-full bg-background/40 border border-surface-border rounded-lg p-3.5 text-sm text-foreground placeholder-gray-400 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30 focus:bg-surface transition-all resize-none font-sans leading-relaxed"
        />

        {/* Media Attachments Preview Grid */}
        {mediaFiles.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-gray-500">
              <span>已选媒体附件 ({mediaFiles.length}/12)</span>
              <button
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
              <span>添加附件 ({mediaFiles.length}/12)</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={mediaFiles.length >= 12 || isSubmitting}
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

            {charCount > 280 && (
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
              selectedAccountIds.length === 0
            }
            className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-glow-terracotta active:scale-[0.98]"
          >
            <Send className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
            <span>
              {isSubmitting
                ? `发布中 (${elapsedSec}s)...`
                : t.composer.broadcastBtn}
            </span>
          </button>
        </div>
      </div>

      {/* Result Card */}
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
            <div className="space-y-0.5">
              <span className="font-semibold block">{resultMsg.text}</span>
              {resultMsg.durationMs && (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
                  <Zap className="w-2.5 h-2.5" />
                  <span>响应耗时 {resultMsg.durationMs < 1000 ? `${resultMsg.durationMs}ms` : `${(resultMsg.durationMs / 1000).toFixed(2)}s`}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {resultMsg.url && (
              <>
                <button
                  onClick={() => copyUrl(resultMsg.url!)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors text-[11px]"
                  title="复制推文链接"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制链接</span>
                    </>
                  )}
                </button>
                <a
                  href={resultMsg.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-3 py-1 rounded bg-brand text-white hover:bg-brand-hover font-semibold text-[11px] transition-all shadow-2xs"
                >
                  <span>{t.composer.openOnX}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}

            {onOpenLogs && (
              <button
                onClick={onOpenLogs}
                className="flex items-center gap-1 text-gray-600 hover:text-foreground text-[11px] underline ml-1"
              >
                <span>查看流水</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Thread Split Preview Sequence */}
      {previewChunks.length > 1 && (
        <div className="rounded-xl bg-surface border border-surface-border p-4 space-y-3 shadow-panel">
          <div className="flex items-center justify-between text-xs font-mono text-gray-700">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-brand" />
              <span className="font-semibold uppercase tracking-wider">{t.composer.threadPreview}</span>
            </div>
            <span className="text-[11px] text-gray-500 font-mono">共 {previewChunks.length} 条推文串接</span>
          </div>

          <div className="space-y-2.5">
            {previewChunks.map((chunk, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-surface-muted/50 border border-surface-border text-xs font-mono text-gray-800 whitespace-pre-wrap relative pl-9 surface-hover-card"
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
