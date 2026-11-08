import React, { useState } from 'react'
import { Account } from '../../../shared/types'
import { Send, CheckCircle2, AlertCircle, Layers, Image as ImageIcon, X } from 'lucide-react'
import { useI18n } from '../i18n'

interface ComposerProps {
  accounts: Account[]
}

export const Composer: React.FC<ComposerProps> = ({ accounts }) => {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [mediaFiles, setMediaFiles] = useState<Array<{ dataBase64: string; name: string; type: string }>>([])
  const [splitThread, setSplitThread] = useState(true)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resultMsg, setResultMsg] = useState<{ type: 'success' | 'error'; text: string; url?: string } | null>(null)

  const twitterAccounts = accounts.filter((a) => a.platform === 'twitter' && a.status === 'active')

  // Auto select first twitter account
  React.useEffect(() => {
    if (selectedAccountIds.length === 0 && twitterAccounts.length > 0) {
      setSelectedAccountIds([twitterAccounts[0].id])
    }
  }, [twitterAccounts])

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileList = Array.from(files)
    // Support multiple images per tweet/thread
    for (const file of fileList.slice(0, 12 - mediaFiles.length)) {
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

  const handlePublish = async () => {
    if ((!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0) return
    setIsSubmitting(true)
    setResultMsg(null)

    try {
      const targets = selectedAccountIds.map((id) => ({
        platform: 'twitter' as const,
        accountId: id
      }))

      const res = await window.rosetta.sendUnifiedPost({
        text,
        mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
        targets,
        options: { splitThreadIfLong: splitThread }
      })

      if (res.success) {
        const firstSuccess = res.results.find((r) => r.success)
        setResultMsg({
          type: 'success',
          text: t.composer.publishSuccess,
          url: firstSuccess?.url
        })
        setText('')
        setMediaFiles([])
      } else {
        const err = res.results.find((r) => r.error)?.error || 'Failed to publish post'
        setResultMsg({ type: 'error', text: err })
      }
    } catch (err: any) {
      setResultMsg({ type: 'error', text: err.message || 'Execution error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground font-mono tracking-tight">{t.composer.title}</h2>
          <p className="text-xs text-gray-500 font-mono">{t.composer.desc}</p>
        </div>

        {/* Account selector pills */}
        <div className="flex items-center gap-2">
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
                    ? 'bg-brand-subtle text-brand border-brand-border shadow-sm font-semibold'
                    : 'bg-surface border-surface-border text-gray-600 hover:text-foreground'
                }`}
              >
                {acc.avatarUrl ? (
                  <img src={acc.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                )}
                <span>@{acc.username}</span>
              </button>
            )
          })}
          {twitterAccounts.length === 0 && (
            <span className="text-xs font-mono text-amber-700">{t.composer.noTwitterAcc}</span>
          )}
        </div>
      </div>

      {/* Editor Box */}
      <div className="rounded-xl bg-surface border border-surface-border p-4 shadow-panel space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.composer.placeholder}
          rows={6}
          className="w-full bg-background/50 border border-surface-border rounded-lg p-3.5 text-sm text-foreground placeholder-gray-400 focus:outline-none focus:border-brand focus:bg-surface transition-all resize-none font-sans"
        />

        {/* Media Attachments Preview */}
        {mediaFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {mediaFiles.map((f, i) => (
              <div key={i} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-surface-border bg-black/5">
                {f.type.startsWith('video/') ? (
                  <video src={f.dataBase64} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={f.dataBase64} alt={f.name} className="w-full h-full object-cover" />
                )}
                <button
                  onClick={() => setMediaFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-1 right-1 bg-black/70 hover:bg-black text-white rounded-full p-0.5 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Status / Character bar */}
        <div className="flex items-center justify-between pt-2 border-t border-surface-border">
          <div className="flex items-center gap-4 text-xs font-mono">
            {/* Media attachment button */}
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-border hover:border-gray-400 bg-surface text-gray-700 hover:text-foreground cursor-pointer text-xs font-mono transition-colors">
              <ImageIcon className="w-3.5 h-3.5 text-brand" />
              <span>多媒体 ({mediaFiles.length}/12)</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={mediaFiles.length >= 12}
              />
            </label>

            <div className="flex items-center gap-1.5">
              <span
                className={`font-semibold ${
                  charCount > 280
                    ? willThread
                      ? 'text-brand'
                      : 'text-rose-600'
                    : 'text-gray-700'
                }`}
              >
                {charCount}
              </span>
              <span className="text-gray-500">/ 280 {t.composer.chars}</span>
            </div>

            {charCount > 280 && (
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={splitThread}
                  onChange={(e) => setSplitThread(e.target.checked)}
                  className="rounded border-surface-border text-brand focus:ring-brand"
                />
                <span className="flex items-center gap-1 text-brand font-medium">
                  <Layers className="w-3.5 h-3.5" />
                  {t.composer.autoThread} ({previewChunks.length} {t.composer.tweets})
                </span>
              </label>
            )}
          </div>

          <button
            onClick={handlePublish}
            disabled={isSubmitting || (!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-mono font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-glow-terracotta active:scale-[0.98]"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? t.composer.publishing : t.composer.broadcastBtn}</span>
          </button>
        </div>
      </div>

      {/* Result Alert */}
      {resultMsg && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs font-mono ${
            resultMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-rose-50 text-rose-800 border-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {resultMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{resultMsg.text}</span>
          </div>
          {resultMsg.url && (
            <a
              href={resultMsg.url}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline flex items-center gap-1 font-semibold"
            >
              {t.composer.openOnX}
            </a>
          )}
        </div>
      )}

      {/* Thread Split Preview */}
      {previewChunks.length > 1 && (
        <div className="rounded-xl bg-surface border border-surface-border p-4 space-y-3 shadow-panel">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-700">
            <Layers className="w-4 h-4 text-brand" />
            <span className="font-semibold uppercase tracking-wider">{t.composer.threadPreview}</span>
          </div>

          <div className="space-y-2">
            {previewChunks.map((chunk, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-surface-muted/60 border border-surface-border text-xs font-mono text-gray-800 whitespace-pre-wrap relative pl-8"
              >
                <span className="absolute left-3 top-3 text-[10px] text-gray-400 font-semibold">#{idx + 1}</span>
                {chunk}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
