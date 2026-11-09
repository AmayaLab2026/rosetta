import React, { useState, useEffect } from 'react'
import { TelegramChannelPost, TwitterPostItem, Account } from '../../../shared/types'
import {
  Trash2,
  ExternalLink,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  FileVideo,
  Image as ImageIcon,
  Send,
  ArrowRight,
  ShieldAlert,
  Hash
} from 'lucide-react'
import { useI18n } from '../i18n'

interface DeletionViewProps {
  accounts: Account[]
}

export const DeletionView: React.FC<DeletionViewProps> = ({ accounts }) => {
  const { t } = useI18n()
  const [activePlatform, setActivePlatform] = useState<'telegram' | 'twitter'>('telegram')

  // Telegram States
  const [tgChannel, setTgChannel] = useState('')
  const [tgPosts, setTgPosts] = useState<TelegramChannelPost[]>([])
  const [tgLoading, setTgLoading] = useState(false)
  const [tgDeletingId, setTgDeletingId] = useState<number | null>(null)
  const [tgFeedback, setTgFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Twitter States
  const [twPosts, setTwPosts] = useState<TwitterPostItem[]>([])
  const [twLoading, setTwLoading] = useState(false)
  const [twDeletingId, setTwDeletingId] = useState<string | null>(null)
  const [twFeedback, setTwFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const activeTwitterAccount = accounts.find((a) => a.platform === 'twitter' && a.status === 'active')

  // Load saved default channel on mount
  useEffect(() => {
    window.rosetta.getSettings?.().then((st) => {
      if (st?.defaultBotChatId) {
        setTgChannel(st.defaultBotChatId)
      }
    }).catch(() => {})
  }, [])

  // Fetch 5 Telegram Recent Posts
  const handleFetchTelegramPosts = async () => {
    setTgLoading(true)
    setTgFeedback(null)
    try {
      const items = await window.rosetta.getTelegramRecentPosts?.({
        channelId: tgChannel.trim() || undefined,
        limit: 5
      })
      setTgPosts(items || [])
      if (!items || items.length === 0) {
        setTgFeedback({ type: 'error', text: t.deletion.tgNoPostsFound })
      }
    } catch (e: any) {
      setTgFeedback({ type: 'error', text: e.message || t.deletion.fetchFailed })
    } finally {
      setTgLoading(false)
    }
  }

  // Delete a Telegram post
  const handleDeleteTelegramPost = async (messageId: number) => {
    if (!window.confirm(`${t.deletion.confirmDeleteTg} #${messageId}?`)) return
    setTgDeletingId(messageId)
    setTgFeedback(null)
    try {
      const res = await window.rosetta.deleteTelegramChannelPost({
        channelId: tgChannel.trim() || undefined,
        messageId
      })
      if (res.success) {
        setTgPosts((prev) => prev.filter((p) => p.id !== messageId))
        setTgFeedback({ type: 'success', text: `${t.deletion.deletedTgSuccess} #${messageId}` })
      } else {
        setTgFeedback({ type: 'error', text: res.error || t.deletion.deleteFailed })
      }
    } catch (e: any) {
      setTgFeedback({ type: 'error', text: e.message || t.deletion.deleteFailed })
    } finally {
      setTgDeletingId(null)
    }
  }

  // Fetch 5 Twitter Recent Posts
  const handleFetchTwitterPosts = async () => {
    if (!activeTwitterAccount) {
      setTwFeedback({ type: 'error', text: t.deletion.noTwitterAccount })
      return
    }
    setTwLoading(true)
    setTwFeedback(null)
    try {
      const items = await window.rosetta.getTwitterRecentPosts?.({
        accountId: activeTwitterAccount.id,
        limit: 5
      })
      setTwPosts(items || [])
      if (!items || items.length === 0) {
        setTwFeedback({ type: 'error', text: t.deletion.twNoPostsFound })
      }
    } catch (e: any) {
      setTwFeedback({ type: 'error', text: e.message || t.deletion.fetchFailed })
    } finally {
      setTwLoading(false)
    }
  }

  // Delete a Twitter post
  const handleDeleteTwitterPost = async (tweetId: string) => {
    if (!activeTwitterAccount) return
    if (!window.confirm(`${t.deletion.confirmDeleteTw} #${tweetId}?`)) return
    setTwDeletingId(tweetId)
    setTwFeedback(null)
    try {
      const res = await window.rosetta.deleteTwitterTweet({
        accountId: activeTwitterAccount.id,
        tweetId
      })
      if (res.success) {
        setTwPosts((prev) => prev.filter((p) => p.id !== tweetId))
        setTwFeedback({ type: 'success', text: `${t.deletion.deletedTwSuccess} #${tweetId}` })
      } else {
        setTwFeedback({ type: 'error', text: res.error || t.deletion.deleteFailed })
      }
    } catch (e: any) {
      setTwFeedback({ type: 'error', text: e.message || t.deletion.deleteFailed })
    } finally {
      setTwDeletingId(null)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto h-full overflow-y-auto font-sans">
      {/* Top Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold text-foreground font-mono tracking-tight flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-600" />
            <span>{t.deletion.title}</span>
          </h2>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-rose-50 text-rose-800 border border-rose-200 shadow-2xs">
            {t.deletion.badge}
          </span>
        </div>
        <p className="text-xs text-gray-500 font-mono mt-0.5">
          {t.deletion.desc}
        </p>
      </div>

      {/* Platform Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-surface-border pb-3 font-mono text-xs">
        <button
          onClick={() => setActivePlatform('telegram')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all border ${
            activePlatform === 'telegram'
              ? 'bg-telegram-subtle text-telegram font-bold border-telegram-border shadow-2xs'
              : 'bg-surface border-surface-border text-gray-600 hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          <span>✈️</span>
          <span>{t.deletion.tabTelegram}</span>
        </button>

        <button
          onClick={() => setActivePlatform('twitter')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all border ${
            activePlatform === 'twitter'
              ? 'bg-sky-50 text-sky-950 font-bold border-sky-300 shadow-2xs'
              : 'bg-surface border-surface-border text-gray-600 hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          <span>𝕏</span>
          <span>{t.deletion.tabTwitter}</span>
        </button>
      </div>

      {/* Panel 1: Telegram Channel Posts Deletion */}
      {activePlatform === 'telegram' && (
        <div className="space-y-4 font-mono text-xs animate-in fade-in duration-150">
          <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-gray-600 font-semibold text-[11px] shrink-0">
                  {t.deletion.targetChannelLabel}:
                </span>
                <input
                  type="text"
                  placeholder="e.g. @LycorisLab or -100123456789"
                  value={tgChannel}
                  onChange={(e) => setTgChannel(e.target.value)}
                  className="w-full sm:w-72 bg-background border border-surface-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:border-brand"
                />
              </div>

              <button
                onClick={handleFetchTelegramPosts}
                disabled={tgLoading || !tgChannel.trim()}
                className="flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium shadow-glow-terracotta transition-all disabled:opacity-50 active:scale-95 shrink-0"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${tgLoading ? 'animate-spin' : ''}`} />
                <span>{tgLoading ? t.deletion.fetching : t.deletion.fetchTgFiveBtn}</span>
              </button>
            </div>

            {tgFeedback && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                  tgFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                {tgFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{tgFeedback.text}</span>
              </div>
            )}
          </div>

          {/* Posts List */}
          <div className="space-y-3">
            {tgPosts.map((post) => (
              <div
                key={post.id}
                className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel hover:border-gray-400 transition-all space-y-2 surface-hover-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-telegram font-bold bg-telegram-subtle px-2 py-0.5 rounded border border-telegram-border/50 text-[11px]">
                      {tgChannel}
                    </span>
                    <span className="text-gray-700 bg-surface-muted px-2 py-0.5 rounded border border-surface-border text-[11px] font-semibold">
                      Msg #{post.id}
                    </span>
                    <span className="text-gray-400 text-[11px]">
                      {new Date(post.date).toLocaleString()}
                    </span>
                    {post.hasMedia && (
                      <span className="text-[10px] text-gray-600 bg-surface px-1.5 py-0.5 rounded border border-surface-border flex items-center gap-1">
                        {post.mediaType === 'video' ? <FileVideo className="w-3 h-3 text-brand" /> : <ImageIcon className="w-3 h-3 text-brand" />}
                        <span>{post.mediaType === 'video' ? '视频' : '图片/媒体'}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {post.url && (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline flex items-center gap-1 text-[11px] font-semibold bg-brand-subtle px-2.5 py-1 rounded border border-brand-border/60 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>{t.deletion.openLink}</span>
                      </a>
                    )}

                    <button
                      onClick={() => handleDeleteTelegramPost(post.id)}
                      disabled={tgDeletingId === post.id}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 border border-rose-300 text-xs font-semibold transition-all disabled:opacity-50 active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{tgDeletingId === post.id ? t.deletion.deleting : t.deletion.deleteTgBtn}</span>
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface-muted/40 border border-surface-border text-gray-800 text-xs whitespace-pre-wrap leading-relaxed select-text font-sans">
                  {post.text || (post.hasMedia ? t.deletion.mediaOnlyPlaceholder : '')}
                </div>
              </div>
            ))}

            {tgPosts.length === 0 && !tgLoading && (
              <div className="py-16 text-center text-gray-400 rounded-xl bg-surface border border-surface-border shadow-panel space-y-2">
                <p>{t.deletion.clickToFetchTg}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Panel 2: Twitter Posts Deletion */}
      {activePlatform === 'twitter' && (
        <div className="space-y-4 font-mono text-xs animate-in fade-in duration-150">
          <div className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-gray-600 font-semibold text-[11px]">
                  {t.deletion.currentTwitterAccount}:
                </span>
                <span className="font-bold text-foreground bg-surface-muted px-2 py-0.5 rounded border border-surface-border">
                  {activeTwitterAccount ? `@${activeTwitterAccount.username}` : t.deletion.noActiveTwitter}
                </span>
              </div>

              <button
                onClick={handleFetchTwitterPosts}
                disabled={twLoading || !activeTwitterAccount}
                className="flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium shadow-glow-terracotta transition-all disabled:opacity-50 active:scale-95 shrink-0"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${twLoading ? 'animate-spin' : ''}`} />
                <span>{twLoading ? t.deletion.fetching : t.deletion.fetchTwFiveBtn}</span>
              </button>
            </div>

            {twFeedback && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                  twFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                {twFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{twFeedback.text}</span>
              </div>
            )}
          </div>

          {/* Tweets List */}
          <div className="space-y-3">
            {twPosts.map((tweet) => (
              <div
                key={tweet.id}
                className="p-4 rounded-xl bg-surface border border-surface-border shadow-panel hover:border-gray-400 transition-all space-y-2 surface-hover-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 bg-surface-muted px-2 py-0.5 rounded border border-surface-border text-[11px]">
                      Tweet #{tweet.id}
                    </span>
                    <span className="text-gray-400 text-[11px]">
                      {new Date(tweet.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {tweet.url && (
                      <a
                        href={tweet.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline flex items-center gap-1 text-[11px] font-semibold bg-brand-subtle px-2.5 py-1 rounded border border-brand-border/60 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>{t.deletion.openLink}</span>
                      </a>
                    )}

                    <button
                      onClick={() => handleDeleteTwitterPost(tweet.id)}
                      disabled={twDeletingId === tweet.id}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 border border-rose-300 text-xs font-semibold transition-all disabled:opacity-50 active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{twDeletingId === tweet.id ? t.deletion.deleting : t.deletion.deleteTwBtn}</span>
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-surface-muted/40 border border-surface-border text-gray-800 text-xs whitespace-pre-wrap leading-relaxed select-text font-sans">
                  {tweet.text}
                </div>
              </div>
            ))}

            {twPosts.length === 0 && !twLoading && (
              <div className="py-16 text-center text-gray-400 rounded-xl bg-surface border border-surface-border shadow-panel space-y-2">
                <p>{t.deletion.clickToFetchTw}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
