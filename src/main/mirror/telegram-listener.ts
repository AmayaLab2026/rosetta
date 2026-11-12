import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import { CustomFile } from 'telegram/client/uploads'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { appStore } from '../storage/store'
import { twitterDriver } from '../drivers/twitter'
import { ContentPipeline } from './pipeline'
import { Account, MirrorLogItem } from '../../shared/types'

export interface MediaItem {
  buffer: Buffer
  mimeType?: string
  isVideo?: boolean
}

export class TelegramMirrorService extends EventEmitter {
  private client: TelegramClient | null = null
  private isRunning: boolean = false
  private authClient: TelegramClient | null = null

  constructor() {
    super()
  }
  private selfSentCache = new Map<string, number>()
  private albumBuffers = new Map<
    string,
    {
      groupedId: string
      chat: any
      chatId: string
      chatUsername: string
      chatTitle: string
      messageIds: number[]
      rawTexts: string[]
      attributionSource: { username?: string; name?: string }
      messageDate: Date
      mediaBuffers: MediaItem[]
      timer?: NodeJS.Timeout
    }
  >()

  public markSelfSentMessage(chatId: string, messageId: number, text?: string): void {
    const normChat = (chatId || '').replace(/^-100/, '').replace(/^@/, '').toLowerCase().trim()
    this.selfSentCache.set(`${normChat}_${messageId}`, Date.now())
    if (text && text.trim()) {
      const snippet = text.trim().slice(0, 80)
      this.selfSentCache.set(`${normChat}_text_${snippet}`, Date.now())
    }

    // Clean up entries older than 2 hours
    const now = Date.now()
    for (const [k, time] of this.selfSentCache.entries()) {
      if (now - time > 2 * 3600 * 1000) {
        this.selfSentCache.delete(k)
      }
    }
  }

  public isSelfSentMessage(chatId: string, messageId: number, text?: string): boolean {
    const normChat = (chatId || '').replace(/^-100/, '').replace(/^@/, '').toLowerCase().trim()
    if (this.selfSentCache.has(`${normChat}_${messageId}`)) {
      return true
    }
    if (text && text.trim()) {
      const snippet = text.trim().slice(0, 80)
      if (this.selfSentCache.has(`${normChat}_text_${snippet}`)) {
        return true
      }
    }
    return false
  }

  public getStatus() {
    const running = Boolean(this.isRunning && this.client && !(this.client as any)._destroyed)
    const rules = appStore.getRules().filter((r) => r.enabled)
    return {
      running,
      engineRunning: running,
      activeRulesCount: rules.length
    }
  }

  public getClient(): TelegramClient | null {
    return this.client
  }

  /**
   * Start listening to Telegram channels and mirroring to target platforms
   */
  async start(): Promise<boolean> {
    if (this.isRunning) return true

    const tgAccount = appStore.getAccounts().find((a) => a.platform === 'telegram' && a.status === 'active')
    if (!tgAccount || !tgAccount.credentials.sessionString || !tgAccount.credentials.apiId || !tgAccount.credentials.apiHash) {
      console.warn('[Mirror] No active Telegram account found')
      return false
    }

    try {
      const session = new StringSession(tgAccount.credentials.sessionString)
      this.client = new TelegramClient(session, tgAccount.credentials.apiId, tgAccount.credentials.apiHash, {
        connectionRetries: 10
      })

      await this.client.connect()
      this.isRunning = true

      console.log('[Mirror] Connected to Telegram as', tgAccount.username)

      // Automatically fetch avatar and profile info in background
      this.fetchUserProfile(tgAccount).then((profile) => {
        if (profile.avatarUrl || profile.displayName) {
          if (profile.avatarUrl) tgAccount.avatarUrl = profile.avatarUrl
          if (profile.displayName) tgAccount.displayName = profile.displayName
          appStore.saveAccount(tgAccount)
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send('accounts:updated', tgAccount)
            }
          })
        }
      }).catch(() => {})

      // Register new message listener
      this.client.addEventHandler(async (event: any) => {
        try {
          await this.handleIncomingMessage(event)
        } catch (err) {
          console.error('[Mirror] Error handling message:', err)
        }
      }, new NewMessage({}))


      this.notifyStatusChange()
      return true
    } catch (err) {
      console.error('[Mirror] Failed to start Telegram listener:', err)
      this.isRunning = false
      this.notifyStatusChange()
      return false
    }
  }

  /**
   * Stop Telegram mirror listener
   */
  async stop(): Promise<boolean> {
    if (this.client) {
      try {
        await this.client.disconnect()
      } catch (e) {
        // ignore
      }
      this.client = null
    }
    this.isRunning = false
    this.notifyStatusChange()
    return true
  }

  /**
   * Handle incoming message event from Telegram.
   * If message belongs to an album (groupedId), debounces and aggregates all media and caption
   * into a single unified post before dispatching to Twitter.
   */
  private async handleIncomingMessage(event: any): Promise<void> {
    const message = event.message
    if (!message || (!message.message && !message.media)) return

    const chat = await message.getChat()
    const rawText = message.message || ''

    const chatUsername = chat?.username ? `@${chat.username}` : ''
    const chatId = chat?.id?.toString() || ''
    const chatTitle = chat?.title || chatUsername || 'Channel'
    const messageDate = message.date ? new Date(message.date * 1000) : new Date()

    // 1. Anti-Echo Guard: Check if this message was sent directly by Rosetta to prevent dual-broadcast duplicate posts on Twitter
    if (
      this.isSelfSentMessage(chatUsername, message.id, rawText) ||
      this.isSelfSentMessage(chatId, message.id, rawText)
    ) {
      console.log(`[Mirror] Suppressed self-sent message #${message.id} in "${chatTitle}" to prevent dual-broadcast duplicate post on Twitter.`)
      return
    }

    // 2. Anti-Echo Guard: Check if message author is the configured Rosetta Bot
    const botToken = appStore.getSettings().defaultBotToken || ''
    const botIdMatch = botToken.match(/^(\d+):/)
    if (botIdMatch) {
      const botId = botIdMatch[1]
      const senderId = message.fromId?.userId?.toString() || message.senderId?.toString() || message.fromId?.toString() || ''
      if (senderId && senderId === botId) {
        console.log(`[Mirror] Suppressed message #${message.id} authored by Rosetta Bot (${botId}) to prevent echo loop.`)
        return
      }
    }

    // Determine the attribution source (Forward origin, or current channel)
    let attributionSource: { username?: string; name?: string } = {}

    if (message.fwdFrom) {
      if (message.fwdFrom.fromName) {
        attributionSource = { name: message.fwdFrom.fromName }
      } else if (message.fwdFrom.fromId && this.client) {
        try {
          const entity: any = await this.client.getEntity(message.fwdFrom.fromId)
          if (entity?.username) {
            attributionSource = { username: entity.username }
          } else {
            const displayName =
              entity?.title ||
              [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') ||
              ''
            attributionSource = { name: displayName }
          }
        } catch (e) {
          console.warn('[Mirror] Failed to fetch forward entity:', e)
        }
      }
    }

    // If not a forwarded message (or failed to get forward source), use current channel
    if (!attributionSource.username && !attributionSource.name) {
      if (chat?.username) {
        attributionSource = { username: chat.username }
      } else {
        attributionSource = { name: chat?.title || chatTitle }
      }
    }

    // Check and drop Telegram stickers, animated stickers, custom emojis, and dice
    const isSticker =
      Boolean(message.sticker) ||
      Boolean(message.dice) ||
      message.media?.className === 'MessageMediaDice' ||
      message.media?.document?.mimeType === 'application/x-tgsticker' ||
      message.media?.document?.attributes?.some(
        (a: any) =>
          a.className === 'DocumentAttributeSticker' ||
          a.className === 'DocumentAttributeCustomEmoji'
      )

    if (isSticker) {
      console.log(`[Mirror] Dropped sticker/custom emoji message #${message.id} from "${chatTitle}" per drop rule.`)
      return
    }

    // If message has no real text and no media, drop it
    const cleanRaw = rawText.replace(/\[(?:Custom Emoji|Emoji|Sticker)[^\]]*\]/gi, '').trim()
    if (!cleanRaw && !message.media) {
      console.log(`[Mirror] Dropped empty / pure emoji text message #${message.id} from "${chatTitle}".`)
      return
    }

    // Download media buffer if present (supports photos, videos, gifs)
    let downloadedMedia: MediaItem | null = null
    if (message.media && this.client) {
      try {
        const isDocVideo =
          Boolean(message.video) ||
          message.media?.document?.mimeType?.startsWith('video/') ||
          message.media?.document?.attributes?.some((a: any) => a.className === 'DocumentAttributeVideo') ||
          (message.file?.name && /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(message.file.name))

        let mimeType = isDocVideo ? message.media?.document?.mimeType || 'video/mp4' : 'image/jpeg'
        if (isDocVideo && !mimeType.startsWith('video/')) {
          mimeType = 'video/mp4'
        } else if (!isDocVideo && message.media?.document?.mimeType) {
          mimeType = message.media.document.mimeType
        }

        const buf = await this.client.downloadMedia(message, {})
        if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
          downloadedMedia = { buffer: buf, mimeType, isVideo: isDocVideo }
        }
      } catch (err: any) {
        console.warn('[Mirror] Failed to download media from Telegram:', err)
      }
    }

    // Check if message belongs to an album (groupedId)
    const groupedId = message.groupedId ? message.groupedId.toString() : null

    if (groupedId) {
      let album = this.albumBuffers.get(groupedId)
      if (!album) {
        album = {
          groupedId,
          chat,
          chatId,
          chatUsername,
          chatTitle,
          messageIds: [],
          rawTexts: [],
          attributionSource,
          messageDate,
          mediaBuffers: []
        }
        this.albumBuffers.set(groupedId, album)
      }

      if (album.timer) {
        clearTimeout(album.timer)
      }

      album.messageIds.push(message.id)
      if (rawText.trim()) {
        album.rawTexts.push(rawText.trim())
      }
      if (downloadedMedia) {
        album.mediaBuffers.push(downloadedMedia)
      }
      if (!album.attributionSource.username && !album.attributionSource.name) {
        album.attributionSource = attributionSource
      }

      // Fast debounce (750ms) for sibling media messages to arrive before publishing
      album.timer = setTimeout(() => {
        this.flushAlbum(groupedId)
      }, 750)

      return
    }

    // Single individual post: process immediately
    await this.processAggregatedMessage({
      chat,
      chatId,
      chatUsername,
      chatTitle,
      messageIds: [message.id],
      rawText,
      mediaBuffers: downloadedMedia ? [downloadedMedia] : [],
      attributionSource,
      messageDate
    })
  }

  /**
   * Flush and publish an entire aggregated album of media
   */
  private async flushAlbum(groupedId: string): Promise<void> {
    const album = this.albumBuffers.get(groupedId)
    if (!album) return
    this.albumBuffers.delete(groupedId)

    const rawText = album.rawTexts.join('\n\n') || ''
    console.log(
      `[Mirror] Album ${groupedId} aggregated ${album.mediaBuffers.length} images and ${album.messageIds.length} messages. Processing mirror...`
    )

    await this.processAggregatedMessage({
      chat: album.chat,
      chatId: album.chatId,
      chatUsername: album.chatUsername,
      chatTitle: album.chatTitle,
      messageIds: album.messageIds,
      rawText,
      mediaBuffers: album.mediaBuffers,
      attributionSource: album.attributionSource,
      messageDate: album.messageDate
    })
  }

  /**
   * Process and mirror an aggregated message (with full set of media) to target platforms
   */
  private async processAggregatedMessage(params: {
    chat: any
    chatId: string
    chatUsername: string
    chatTitle: string
    messageIds: number[]
    rawText: string
    mediaBuffers: MediaItem[]
    attributionSource: { username?: string; name?: string }
    messageDate: Date
  }): Promise<void> {
    const {
      chat,
      chatId,
      chatUsername,
      chatTitle,
      messageIds,
      rawText,
      mediaBuffers,
      attributionSource,
      messageDate
    } = params

    // Find all matching enabled rules (match against username, channel title, or channel ID)
    const rules = appStore.getRules().filter((r) => {
      if (!r.enabled) return false
      const source = (r.sourceChannel.username || r.sourceChannel.title || '')
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/^https?:\/\/t\.me\//, '')
        .trim()
      const incomingUsername = (chat?.username || '').toLowerCase().replace(/^@/, '').trim()
      const incomingTitle = (chat?.title || '').toLowerCase().trim()
      const incomingId = (chat?.id?.toString() || '').replace(/^-100/, '')

      return (
        (incomingUsername && source === incomingUsername) ||
        (incomingTitle && (source === incomingTitle || incomingTitle.includes(source))) ||
        (r.sourceChannel.id && (r.sourceChannel.id === chatId || r.sourceChannel.id.replace(/^-100/, '') === incomingId))
      )
    })

    if (rules.length === 0) {
      console.log(
        `[Mirror] Ignored message from "${chatTitle}" (${chatUsername || 'ID:' + chatId}): no matching enabled rule found.`
      )
      return
    }

    console.log(
      `[Mirror] Processing message from "${chatTitle}" for ${rules.length} matching rule(s). Media count: ${mediaBuffers.length}`
    )

    for (const rule of rules) {
      const startTime = Date.now()
      const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      let targetAccount = appStore.getAccount(rule.targetAccount.accountId)

      if (!targetAccount) {
        // Fallback: match by platform and username/accountName, or any active account on that platform
        const allAccounts = appStore.getAccounts()
        targetAccount =
          allAccounts.find(
            (a) =>
              a.platform === rule.targetAccount.platform &&
              rule.targetAccount.accountName &&
              a.username.toLowerCase() === rule.targetAccount.accountName.toLowerCase()
          ) ||
          allAccounts.find(
            (a) => a.platform === rule.targetAccount.platform && a.status === 'active'
          )

        if (targetAccount) {
          // Auto-heal the rule with the new valid account ID
          console.log(
            `[Mirror] Auto-healed target account for rule "${rule.name}": updated orphan ID ${rule.targetAccount.accountId} -> ${targetAccount.id} (@${targetAccount.username})`
          )
          rule.targetAccount.accountId = targetAccount.id
          rule.targetAccount.accountName = targetAccount.username
          appStore.saveRule(rule)
        }
      }

      if (!targetAccount) {
        console.warn(`[Mirror] Rule "${rule.name}" failed: target account not found for platform ${rule.targetAccount.platform}`)
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: rule.targetAccount.platform,
          originalText: rawText || (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
          processedText: '',
          mediaCount: 0,
          status: 'failed',
          errorMessage: 'Target account not found',
          durationMs: Date.now() - startTime
        })
        continue
      }

      // Immediately emit processing log for live UI feedback
      this.emitLog({
        id: logId,
        timestamp: new Date().toISOString(),
        ruleId: rule.id,
        sourceChannel: chatTitle,
        targetPlatform: rule.targetAccount.platform,
        originalText: rawText || (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
        processedText: mediaBuffers.length > 0 ? `正在并发上传 ${mediaBuffers.length} 项附件并同步至 X / Twitter...` : '正在同步至 X / Twitter...',
        mediaCount: mediaBuffers.length,
        status: 'processing'
      })

      // Process content through pipeline with attribution footer (RT: t.me/xxx or RT: Name 西元xxx)
      const { text: processedText, shouldDrop } = ContentPipeline.process(
        rawText,
        rule.filters,
        attributionSource,
        messageDate
      )

      if ((shouldDrop || !processedText.trim()) && mediaBuffers.length === 0) {
        this.emitLog({
          id: logId,
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          sourceChannel: chatTitle,
          targetPlatform: rule.targetAccount.platform,
          originalText: rawText || '[表情包 / 贴纸 / 空白内容]',
          processedText: '[规则拦截] 消息无有效正文或有效媒体附件，已自动丢弃',
          mediaCount: 0,
          status: 'filtered',
          durationMs: Date.now() - startTime
        })
        continue
      }

      // Dispatch to Twitter/X
      if (rule.targetAccount.platform === 'twitter') {
        try {
          // Upload all media attachments (photos & chunked videos) to Twitter in parallel
          const mediaItems: Array<{ mediaId: string; isVideo?: boolean }> = []
          if (rule.filters.forwardMedia !== false && mediaBuffers.length > 0) {
            console.log(`[Mirror] Uploading ${mediaBuffers.length} media attachments to X in parallel...`)
            const uploadPromises = mediaBuffers.map((item) =>
              twitterDriver
                .uploadMedia(targetAccount, item.buffer, item.mimeType)
                .then((res) =>
                  res.success && res.mediaId
                    ? { mediaId: res.mediaId, isVideo: item.isVideo }
                    : null
                )
                .catch((err) => {
                  console.warn('[Mirror] Failed to upload media to Twitter:', err)
                  return null
                })
            )
            const uploaded = await Promise.all(uploadPromises)
            mediaItems.push(
              ...uploaded.filter((m): m is { mediaId: string; isVideo?: boolean } => Boolean(m))
            )
          }

          const tweetContent =
            processedText ||
            ContentPipeline.formatAttribution(
              attributionSource,
              rule.filters.attributionStyle || 'RT',
              messageDate
            )

          // Publish media: videos isolated to dedicated tweets, images grouped, threaded if necessary
          const publishRes = await twitterDriver.publishPostWithMedia(
            targetAccount,
            tweetContent,
            mediaItems,
            rule.filters.autoSplitThread !== false
          )

          // Update rule stats
          rule.stats.totalReceived += 1
          if (publishRes.success) {
            rule.stats.totalForwarded += 1
            rule.stats.lastMirroredAt = new Date().toISOString()
          }
          appStore.saveRule(rule)

          // Record log with duration (always emit, even if publishRes.success === false)
          const durationMs = Date.now() - startTime
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            sourceChannel: chatTitle,
            targetPlatform: 'twitter',
            originalText:
              rawText ||
              (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
            processedText: publishRes.success ? tweetContent : (processedText || '转发推文失败'),
            mediaCount: mediaItems.length,
            status: publishRes.success ? 'success' : 'failed',
            errorMessage: publishRes.error,
            targetUrl: publishRes.url,
            durationMs
          })
        } catch (dispatchErr: any) {
          console.error(`[Mirror] Rule "${rule.name}" encountered fatal error:`, dispatchErr)
          const durationMs = Date.now() - startTime
          this.emitLog({
            id: logId,
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            sourceChannel: chatTitle,
            targetPlatform: 'twitter',
            originalText:
              rawText ||
              (mediaBuffers.length > 0 ? `[全套媒体 - 共 ${mediaBuffers.length} 项]` : '(Media Message)'),
            processedText: '转发流程发生异常',
            mediaCount: mediaBuffers.length,
            status: 'failed',
            errorMessage: dispatchErr?.message || String(dispatchErr) || '未知转发异常',
            durationMs
          })
        }
      }
    }
  }

  /**
   * Fetch recent N messages from a Telegram channel
   */
  async getChannelRecentMessages(channelIdentifier: string, limit = 5): Promise<Array<{
    id: number
    date: string
    text: string
    hasMedia: boolean
    mediaType?: string
    url?: string
  }>> {
    const cleanChan = channelIdentifier.replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '').trim()

    if (this.client && this.isRunning) {
      try {
        let entity: any = channelIdentifier
        if (/^-?\d+$/.test(channelIdentifier)) {
          entity = await this.client.getEntity(channelIdentifier)
        } else {
          entity = await this.client.getInputEntity(channelIdentifier)
        }
        const msgs = await this.client.getMessages(entity, { limit })
        if (Array.isArray(msgs) && msgs.length > 0) {
          return msgs.map((m: any) => {
            let mediaType: string | undefined = undefined
            if (m.video || m.media?.document?.mimeType?.startsWith('video/')) mediaType = 'video'
            else if (m.photo) mediaType = 'photo'
            else if (m.media) mediaType = 'document'

            return {
              id: m.id,
              date: m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString(),
              text: m.message || (m.media ? '[多媒体内容]' : ''),
              hasMedia: Boolean(m.media),
              mediaType,
              url: cleanChan ? `https://t.me/${cleanChan}/${m.id}` : undefined
            }
          })
        }
      } catch (e: any) {
        console.warn(`[TelegramMirrorService] Channel getMessages failed for ${channelIdentifier}:`, e.message)
      }
    }

    // Fallback: load from botPosts store
    const botPosts = appStore.getBotPosts()
    const norm = cleanChan.toLowerCase()
    const matched = botPosts
      .filter((p) => {
        const pNorm = p.chatId.replace(/^-100/, '').replace(/^@/, '').toLowerCase()
        return !cleanChan || pNorm === norm || p.chatId.includes(norm)
      })
      .slice(0, limit)

    return matched.map((p) => ({
      id: p.messageId,
      date: p.sentAt,
      text: p.text,
      hasMedia: p.mediaCount > 0,
      mediaType: p.mediaType === 'video' ? 'video' : p.mediaType === 'photo' || p.mediaType === 'album' ? 'photo' : undefined,
      url: p.postUrl
    }))
  }

  /**
   * Fetch current Telegram user profile (displayName, avatarUrl)
   */
  async fetchUserProfile(account: Account): Promise<{ displayName?: string; avatarUrl?: string }> {
    if (!this.client || !this.isRunning) {
      if (!account.credentials.sessionString || !account.credentials.apiId || !account.credentials.apiHash) {
        return {}
      }
      try {
        const session = new StringSession(account.credentials.sessionString)
        const tempClient = new TelegramClient(session, account.credentials.apiId, account.credentials.apiHash, {
          connectionRetries: 3
        })
        await tempClient.connect()
        const me: any = await tempClient.getMe()
        const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || account.displayName
        let avatarUrl: string | undefined = undefined
        const photo = await tempClient.downloadProfilePhoto(me, { isBig: false })
        if (photo && Buffer.isBuffer(photo) && photo.length > 0) {
          avatarUrl = `data:image/jpeg;base64,${photo.toString('base64')}`
        }
        await tempClient.disconnect().catch(() => {})
        return { displayName, avatarUrl }
      } catch (e) {
        console.warn('[TelegramMirrorService] Failed to fetch profile via temp client:', e)
        return {}
      }
    }

    try {
      const me: any = await this.client.getMe()
      const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || account.displayName
      let avatarUrl: string | undefined = undefined
      const photo = await this.client.downloadProfilePhoto(me, { isBig: false })
      if (photo && Buffer.isBuffer(photo) && photo.length > 0) {
        avatarUrl = `data:image/jpeg;base64,${photo.toString('base64')}`
      }
      return { displayName, avatarUrl }
    } catch (e) {
      console.warn('[TelegramMirrorService] Failed to fetch profile:', e)
      return {}
    }
  }

  private emitLog(log: MirrorLogItem): void {
    appStore.addLog(log)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:log-added', log)
        }
      } catch (e) {
        // ignore
      }
    })
  }

  public notifyStatusChange(): void {
    const status = this.getStatus()
    this.emit('status-changed', status)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:status-changed', status)
        }
      } catch (e) {
        // ignore
      }
    })
  }
}

export const telegramMirrorService = new TelegramMirrorService()
