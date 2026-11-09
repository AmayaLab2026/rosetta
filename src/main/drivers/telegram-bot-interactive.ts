import { appStore } from '../storage/store'
import { twitterDriver } from './twitter'
import { telegramBotDriver } from './telegram-bot'
import { telegramMirrorService } from '../mirror/telegram-listener'
import { MirrorLogItem } from '../../shared/types'
import { BrowserWindow } from 'electron'

interface UserSession {
  step: 'idle' | 'waiting_content' | 'confirming' | 'publishing'
  mode: 'twitter' | 'telegram' | 'both'
  content: {
    text: string
    mediaFiles: Array<{ buffer: Buffer; mimeType: string; isVideo?: boolean; name?: string }>
  }
  recentTgCache?: Array<{ id: number; text: string; date: string }>
  recentTwCache?: Array<{ id: string; text: string; createdAt: string }>
}

export class TelegramBotInteractiveService {
  private isPolling = false
  private abortController: AbortController | null = null
  private lastUpdateId = 0
  private userSessions = new Map<number, UserSession>()
  private botUsername: string | null = null
  private botFirstName: string | null = null

  public getStatus() {
    return {
      polling: this.isPolling,
      botUsername: this.botUsername,
      botFirstName: this.botFirstName
    }
  }

  public async start(): Promise<boolean> {
    if (this.isPolling) return true

    const settings = appStore.getSettings()
    const token = (settings.defaultBotToken || '').trim()
    if (!token) {
      console.log('[TelegramBotInteractive] No bot token configured, interactive bot polling not started.')
      return false
    }

    // Verify token and fetch bot info
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
      const data = (await res.json()) as any
      if (data.ok && data.result) {
        this.botUsername = data.result.username || null
        this.botFirstName = data.result.first_name || null
        console.log(`[TelegramBotInteractive] Bot authorized: @${this.botUsername} (${this.botFirstName})`)

        // Activate official Telegram Bot commands menu for instant user selection
        try {
          await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              commands: [
                { command: 'start', description: '🚀 开启发帖菜单 / 发送图文视频' },
                { command: 'delete', description: '🗑️ 撤回/删除已发布贴文 (1~5选项卡)' },
                { command: 'help', description: '📖 使用指南与指令帮助' },
                { command: 'cancel', description: '❌ 取消当前操作 / 重置会话' }
              ]
            })
          })
          console.log('[TelegramBotInteractive] Official Telegram Bot commands menu activated successfully!')
        } catch (cmdErr: any) {
          console.warn('[TelegramBotInteractive] Failed to register setMyCommands:', cmdErr.message)
        }
      } else {
        console.warn('[TelegramBotInteractive] Bot authorization failed:', data.description)
        return false
      }
    } catch (e: any) {
      console.warn('[TelegramBotInteractive] Failed to verify bot token on startup:', e.message)
      return false
    }

    this.isPolling = true
    this.abortController = new AbortController()
    console.log('[TelegramBotInteractive] Starting interactive bot polling loop...')

    this.pollLoop().catch((err) => {
      console.warn('[TelegramBotInteractive] Polling loop terminated with error:', err)
      this.isPolling = false
    })

    return true
  }

  public stop(): void {
    if (!this.isPolling) return
    this.isPolling = false
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    console.log('[TelegramBotInteractive] Interactive bot polling stopped.')
  }

  public async restart(): Promise<boolean> {
    this.stop()
    await new Promise((r) => setTimeout(r, 600))
    return this.start()
  }

  private async pollLoop(): Promise<void> {
    while (this.isPolling) {
      const settings = appStore.getSettings()
      const token = (settings.defaultBotToken || '').trim()
      if (!token) {
        this.stop()
        break
      }

      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId}&timeout=25`
        const res = await fetch(url, {
          signal: this.abortController?.signal
        })

        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 3000))
          continue
        }

        const data = (await res.json()) as any
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id + 1)
            await this.handleUpdate(token, update)
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break
        // Back off on network glitch
        await new Promise((r) => setTimeout(r, 4000))
      }
    }
  }

  private async handleUpdate(token: string, update: any): Promise<void> {
    const baseUrl = `https://api.telegram.org/bot${token}`

    // 1. Handle Callback Query (Button clicks from Inline Keyboard)
    if (update.callback_query) {
      const cb = update.callback_query
      const fromId = cb.from?.id
      const data = cb.data as string
      const messageId = cb.message?.message_id

      // Acknowledge callback immediately
      fetch(`${baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id })
      }).catch(() => {})

      if (!fromId) return

      // Security check for unauthorized user clicks
      if (!appStore.isBotUserAuthorized(fromId)) {
        await this.sendMessage(baseUrl, fromId, '🔒 <b>未授权访问</b>\n请在私聊中直接发送 Rosetta 桌面端显示的 6 位匹配码完成配对。', { parse_mode: 'HTML' })
        return
      }

      let session = this.userSessions.get(fromId)
      if (!session) {
        session = {
          step: 'idle',
          mode: 'both',
          content: { text: '', mediaFiles: [] }
        }
        this.userSessions.set(fromId, session)
      }

      if (data === 'action_cancel') {
        session.step = 'idle'
        session.content = { text: '', mediaFiles: [] }
        await this.sendMessage(baseUrl, fromId, '❌ 已取消本次发布流程。随时发送 /start 即可重新发起发帖。')
        return
      }

      if (data.startsWith('mode_')) {
        const mode = data.replace('mode_', '') as 'twitter' | 'telegram' | 'both'
        session.mode = mode
        session.step = 'waiting_content'
        session.content = { text: '', mediaFiles: [] }

        let modeDesc = '【⚡ 两端同时广播 (Twitter + TG 频道)】'
        if (mode === 'twitter') modeDesc = '【𝕏 仅发往 Twitter (X)】'
        else if (mode === 'telegram') modeDesc = '【✈️ 仅发往 Telegram 频道】'

        await this.sendMessage(
          baseUrl,
          fromId,
          `✅ <b>发布目标已选定</b>\n\n📌 模式：${modeDesc}\n\n💬 <b>请直接发送你要发布的内容：</b>\n• 可以直接发送文字消息\n• 也可以发送图片、多图相册或视频（支持附带文字说明）\n\n<i>随时发送 /cancel 可放弃本次发帖。</i>`,
          { parse_mode: 'HTML' }
        )
        return
      }

      if (data === 'confirm_publish') {
        if (session.step !== 'confirming') {
          await this.sendMessage(baseUrl, fromId, '⚠️ 当前会话已过期，请重新发送 /start 发起发帖。')
          return
        }

        session.step = 'publishing'
        await this.sendMessage(baseUrl, fromId, '⏳ 正在处理媒体并调度多平台发布中，请稍候...')

        // Execute actual multi-platform publish
        await this.executeUserPublish(baseUrl, fromId, session)
        session.step = 'idle'
        session.content = { text: '', mediaFiles: [] }
        return
      }

      // Delete Menu
      if (data === 'menu_delete') {
        await this.sendMessage(baseUrl, fromId, '🗑️ <b>请选择需要查看并撤回的历史平台：</b>\n（一次性获取最近 5 条已发布贴文并提供 1~5 选项卡选择）', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✈️ 查看电报频道历史 (最近5条)', callback_data: 'del_hist_tg' },
                { text: '𝕏 查看推特推文历史 (最近5条)', callback_data: 'del_hist_tw' }
              ],
              [
                { text: '🔙 返回主菜单', callback_data: 'action_cancel' }
              ]
            ]
          }
        })
        return
      }

      // Get Telegram 5 recent posts in a single consolidated preview with 1~5 selection tabs
      if (data === 'del_hist_tg') {
        const settings = appStore.getSettings()
        const targetChat = settings.defaultBotChatId || ''
        const posts = await telegramMirrorService.getChannelRecentMessages(targetChat, 5)

        if (posts.length === 0) {
          await this.sendMessage(baseUrl, fromId, `⚠️ 暂未查询到电报频道 <code>${targetChat || '默认频道'}</code> 的历史消息。`, { parse_mode: 'HTML' })
          return
        }

        session.recentTgCache = posts.map((p) => ({
          id: p.id,
          text: p.text || (p.hasMedia ? '[多媒体内容]' : ''),
          date: p.date
        }))

        const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']
        let summaryText = `📋 <b>电报频道 ${targetChat} 最近 ${posts.length} 条贴文：</b>\n\n`
        posts.forEach((p, idx) => {
          const preview = p.text.length > 50 ? `${p.text.slice(0, 50)}...` : (p.text || (p.hasMedia ? '[多媒体内容]' : '(空)'))
          summaryText += `${numEmojis[idx]} <b>#${p.id}</b> (${new Date(p.date).toLocaleTimeString()})\n<blockquote>${this.escapeHtml(preview)}</blockquote>\n`
        })
        summaryText += `\n<i>请在下方直接点击【1~${posts.length}】选项卡选择要撤回的贴文：</i>`

        const selectButtons = posts.map((_, idx) => ({
          text: `${numEmojis[idx]} 删第${idx + 1}条`,
          callback_data: `sel_del_tg_${idx}`
        }))

        const keyboardRows: any[][] = []
        if (selectButtons.length <= 3) {
          keyboardRows.push(selectButtons)
        } else {
          keyboardRows.push(selectButtons.slice(0, 3))
          keyboardRows.push(selectButtons.slice(3))
        }
        keyboardRows.push([{ text: '🔙 取消', callback_data: 'action_cancel' }])

        await this.sendMessage(baseUrl, fromId, summaryText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        })
        return
      }

      // Get Twitter 5 recent tweets in a single consolidated preview with 1~5 selection tabs
      if (data === 'del_hist_tw') {
        const activeTwAcc = appStore.getAccounts().find((a) => a.platform === 'twitter' && a.status === 'active')
        if (!activeTwAcc) {
          await this.sendMessage(baseUrl, fromId, '⚠️ 未在 Rosetta 中绑定活跃的 X / Twitter 账号。')
          return
        }

        const tweets = await twitterDriver.fetchRecentTweetsForDeletion(activeTwAcc, 5)
        if (tweets.length === 0) {
          await this.sendMessage(baseUrl, fromId, `⚠️ 暂未获取到 @${activeTwAcc.username} 的推文记录。`)
          return
        }

        session.recentTwCache = tweets.map((tw) => ({
          id: String(tw.id).trim(),
          text: tw.text,
          createdAt: tw.createdAt
        }))

        const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']
        let summaryText = `📋 <b>Twitter @${activeTwAcc.username} 最近 ${tweets.length} 条推文：</b>\n\n`
        tweets.forEach((tw, idx) => {
          const preview = tw.text.length > 50 ? `${tw.text.slice(0, 50)}...` : (tw.text || '(空)')
          summaryText += `${numEmojis[idx]} <b>#${tw.id}</b> (${new Date(tw.createdAt).toLocaleTimeString()})\n<blockquote>${this.escapeHtml(preview)}</blockquote>\n`
        })
        summaryText += `\n<i>请在下方直接点击【1~${tweets.length}】选项卡选择要删除的推文：</i>`

        const selectButtons = tweets.map((_, idx) => ({
          text: `${numEmojis[idx]} 删第${idx + 1}条`,
          callback_data: `sel_del_tw_${idx}`
        }))

        const keyboardRows: any[][] = []
        if (selectButtons.length <= 3) {
          keyboardRows.push(selectButtons)
        } else {
          keyboardRows.push(selectButtons.slice(0, 3))
          keyboardRows.push(selectButtons.slice(3))
        }
        keyboardRows.push([{ text: '🔙 取消', callback_data: 'action_cancel' }])

        await this.sendMessage(baseUrl, fromId, summaryText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        })
        return
      }

      // Execute TG Message Revoke from 1~5 selection
      if (data.startsWith('sel_del_tg_')) {
        const idx = parseInt(data.replace('sel_del_tg_', ''), 10)
        const targetPost = session.recentTgCache?.[idx]
        if (!targetPost || !targetPost.id) {
          await this.sendMessage(baseUrl, fromId, '⚠️ 未找到选中的贴文，请重新点击 /delete 检索。')
          return
        }

        const settings = appStore.getSettings()
        const targetChat = settings.defaultBotChatId || ''
        const res = await telegramBotDriver.deletePost({
          chatId: targetChat,
          messageId: targetPost.id,
          botToken: token
        })

        if (res.success) {
          await this.sendMessage(baseUrl, fromId, `✅ <b>已成功撤回第 ${idx + 1} 条电报消息</b> (#${targetPost.id})！`, { parse_mode: 'HTML' })
          session.recentTgCache.splice(idx, 1)
        } else {
          await this.sendMessage(baseUrl, fromId, `❌ 撤回第 ${idx + 1} 条消息 (#${targetPost.id}) 失败：${res.error}`)
        }
        return
      }

      // Execute Twitter Tweet Revoke from 1~5 selection
      if (data.startsWith('sel_del_tw_')) {
        const idx = parseInt(data.replace('sel_del_tw_', ''), 10)
        const targetTweet = session.recentTwCache?.[idx]
        if (!targetTweet || !targetTweet.id) {
          await this.sendMessage(baseUrl, fromId, '⚠️ 未找到选中的推文，请重新点击 /delete 检索。')
          return
        }

        const cleanId = String(targetTweet.id).trim()
        if (!cleanId || cleanId === 'undefined' || !/^\d+$/.test(cleanId)) {
          await this.sendMessage(baseUrl, fromId, `❌ 无法删除：推文 ID 无效 ("${cleanId}")。`)
          return
        }

        const activeTwAcc = appStore.getAccounts().find((a) => a.platform === 'twitter' && a.status === 'active')
        if (!activeTwAcc) {
          await this.sendMessage(baseUrl, fromId, '⚠️ 未找到活跃的 Twitter 账号。')
          return
        }

        const res = await twitterDriver.deleteTweet(activeTwAcc, cleanId)
        if (res.success) {
          await this.sendMessage(baseUrl, fromId, `✅ <b>已成功从 X (Twitter) 删除第 ${idx + 1} 条推文</b> (#${cleanId})！`, { parse_mode: 'HTML' })
          session.recentTwCache.splice(idx, 1)
        } else {
          await this.sendMessage(baseUrl, fromId, `❌ 删除第 ${idx + 1} 条推文 (#${cleanId}) 失败：${res.error}`)
        }
        return
      }

      return
    }

    // 2. Handle Message (Private Chat)
    if (update.message) {
      const msg = update.message
      const fromId = msg.from?.id
      const chatId = msg.chat?.id
      const text = (msg.text || msg.caption || '').trim()

      if (!fromId || !chatId) return

      // --- Security Check: Blocked User Verification ---
      if (appStore.isBotUserBlocked(fromId)) {
        const blockMsg = `🚫 <b>安全访问已被封锁 (Access Blocked)</b>\n\n你的 Telegram 账号由于连续 5 次输入错误匹配码已被系统永久封禁。\n\n如需解封，请在电脑端 Rosetta 桌面应用 ➔「电报机器人」中解封。`
        await this.sendMessage(baseUrl, fromId, blockMsg, { parse_mode: 'HTML' })
        return
      }

      // --- Security Check: Pairing Code Verification ---
      const isAuthorized = appStore.isBotUserAuthorized(fromId)
      if (!isAuthorized) {
        const pairingCode = appStore.getBotPairingCode().trim()
        if (text && text.toLowerCase() === pairingCode.toLowerCase()) {
          appStore.clearBotPairingAttempts(fromId)
          appStore.addBotAuthorizedUserId(fromId)
          console.log(`[TelegramBotInteractive] User #${fromId} successfully paired with matching code!`)

          const successMsg = `🎉 <b>配对成功！身份已通过安全校验并永久授权。</b>\n\n你的 Telegram User ID: <code>${fromId}</code>\n本端已记住你的身份，后续发帖无需重复校验密码。\n\n请在下方点击选择操作：`

          await this.sendMessage(baseUrl, fromId, successMsg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '𝕏 仅发往 Twitter (X)', callback_data: 'mode_twitter' },
                  { text: '✈️ 仅发往 Telegram 频道', callback_data: 'mode_telegram' }
                ],
                [
                  { text: '⚡ 两端同时广播 (X + TG)', callback_data: 'mode_both' }
                ],
                [
                  { text: '🗑️ 撤回/删除历史贴文 (1~5选项卡)', callback_data: 'menu_delete' }
                ]
              ]
            }
          })
          return
        }

        // Record failed attempt
        const fails = appStore.recordBotPairingFailure(fromId)
        if (fails >= 5) {
          const lockedMsg = `🚫 <b>错误次数达到上限，账号已封锁！</b>\n由于连续 5 次匹配码错误，你的 Telegram ID (<code>${fromId}</code>) 已被系统永久封锁。\n\n如需解封，请在电脑端 Rosetta 桌面应用中解除封锁。`
          await this.sendMessage(baseUrl, fromId, lockedMsg, { parse_mode: 'HTML' })
          return
        }

        const remaining = 5 - fails
        // Prompt for pairing code
        const lockMsg = `🔒 <b>Rosetta 主控端安全校验</b>\n\n该机器人已开启身份保护，防止未授权人员使用。\n\n首次使用请输入 Rosetta 桌面端生成的 <b>6位匹配授权码</b>：\n<i>（打开电脑端 Rosetta ➔「电报机器人」即可查看匹配码）</i>\n\n⚠️ 剩余尝试机会：<b>${remaining} / 5</b> 次，连续 5 次错误将自动封禁。`
        await this.sendMessage(baseUrl, fromId, lockMsg, { parse_mode: 'HTML' })
        return
      }

      let session = this.userSessions.get(fromId)
      if (!session) {
        session = {
          step: 'idle',
          mode: 'both',
          content: { text: '', mediaFiles: [] }
        }
        this.userSessions.set(fromId, session)
      }

      // Command: /cancel
      if (text === '/cancel') {
        session.step = 'idle'
        session.content = { text: '', mediaFiles: [] }
        await this.sendMessage(baseUrl, fromId, '❌ 已重置并取消本次发布。发送 /start 可重新开始。')
        return
      }

      // Command: /delete
      if (text === '/delete' || text.startsWith('/delete')) {
        await this.sendMessage(baseUrl, fromId, '🗑️ <b>请选择需要查看并撤回的历史平台：</b>\n（每次获取最近 5 条已发布贴文）', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✈️ 查看电报频道历史 (最近5条)', callback_data: 'del_hist_tg' },
                { text: '𝕏 查看推特推文历史 (最近5条)', callback_data: 'del_hist_tw' }
              ],
              [
                { text: '🔙 取消', callback_data: 'action_cancel' }
              ]
            ]
          }
        })
        return
      }

      // Command: /start or /help
      if (text === '/start' || text.startsWith('/start') || text === '/help') {
        session.step = 'idle'
        session.content = { text: '', mediaFiles: [] }

        const welcomeText = `👋 <b>欢迎使用 Rosetta 社交同步中枢机器人！</b>\n\n你可以直接在此私聊中发送图文或视频，由机器人代发至你的 <b>Telegram 频道</b> 或 <b>Twitter (X)</b>。\n\n请在下方点击选择操作：`

        await this.sendMessage(baseUrl, fromId, welcomeText, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '𝕏 仅发往 Twitter (X)', callback_data: 'mode_twitter' },
                { text: '✈️ 仅发往 Telegram 频道', callback_data: 'mode_telegram' }
              ],
              [
                { text: '⚡ 两端同时广播 (X + TG)', callback_data: 'mode_both' }
              ],
              [
                { text: '🗑️ 撤回/删除历史贴文 (每次5条)', callback_data: 'menu_delete' }
              ],
              [
                { text: '❌ 取消 / 重置', callback_data: 'action_cancel' }
              ]
            ]
          }
        })
        return
      }

      // If user is in 'waiting_content' or sent content directly
      if (session.step === 'waiting_content' || session.step === 'idle') {
        // Collect text and download media if any
        session.content.text = text

        // Download photo if present
        if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
          const largestPhoto = msg.photo[msg.photo.length - 1]
          const fileBuf = await this.downloadFileByFileId(token, largestPhoto.file_id)
          if (fileBuf) {
            session.content.mediaFiles.push({
              buffer: fileBuf,
              mimeType: 'image/jpeg',
              isVideo: false,
              name: 'telegram_photo.jpg'
            })
          }
        }

        // Download video if present
        if (msg.video) {
          const fileBuf = await this.downloadFileByFileId(token, msg.video.file_id)
          if (fileBuf) {
            session.content.mediaFiles.push({
              buffer: fileBuf,
              mimeType: msg.video.mime_type || 'video/mp4',
              isVideo: true,
              name: msg.video.file_name || 'telegram_video.mp4'
            })
          }
        }

        // Download document if it's an image/video
        if (msg.document) {
          const mime = msg.document.mime_type || ''
          const isDocVideo = mime.startsWith('video/')
          const isDocImg = mime.startsWith('image/')
          if (isDocVideo || isDocImg) {
            const fileBuf = await this.downloadFileByFileId(token, msg.document.file_id)
            if (fileBuf) {
              session.content.mediaFiles.push({
                buffer: fileBuf,
                mimeType: mime,
                isVideo: isDocVideo,
                name: msg.document.file_name || (isDocVideo ? 'video.mp4' : 'image.jpg')
              })
            }
          }
        }

        if (!session.content.text && session.content.mediaFiles.length === 0) {
          await this.sendMessage(baseUrl, fromId, '⚠️ 请发送文字内容，或附带图片/视频媒体。发送 /cancel 可取消。')
          return
        }

        session.step = 'confirming'

        // Render confirmation card in Telegram
        let modeLabel = '【⚡ 两端同时广播 (Twitter + Telegram)】'
        if (session.mode === 'twitter') modeLabel = '【𝕏 仅发往 Twitter (X)】'
        else if (session.mode === 'telegram') modeLabel = '【✈️ 仅发往 Telegram 频道】'

        const textSnippet = session.content.text || '(无纯文字，仅包含媒体)'
        const mediaCount = session.content.mediaFiles.length

        const confirmMsg = `📝 <b>内容已就绪，请核对：</b>\n\n📌 <b>目标：</b>${modeLabel}\n📄 <b>文字内容：</b>\n<blockquote>${this.escapeHtml(textSnippet)}</blockquote>\n🖼️ <b>媒体附件：</b>${mediaCount > 0 ? `已挂载 ${mediaCount} 项媒体` : '无附件'}\n\n确认无误请点击下方按钮立即发布：`

        await this.sendMessage(baseUrl, fromId, confirmMsg, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚀 确认发布', callback_data: 'confirm_publish' },
                { text: '❌ 取消', callback_data: 'action_cancel' }
              ]
            ]
          }
        })
      }
    }
  }

  /**
   * Execute actual dispatch to Twitter and/or Telegram channel, then reply to user
   */
  private async executeUserPublish(baseUrl: string, fromId: number, session: UserSession): Promise<void> {
    const { mode, content } = session
    const settings = appStore.getSettings()
    const results: string[] = []
    let hasFailure = false

    const startTime = Date.now()
    const logId = `log_bot_chat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`

    // Log processing start in Rosetta Workstation
    const logItem: MirrorLogItem = {
      id: logId,
      timestamp: new Date().toISOString(),
      ruleId: 'tg_interactive_bot',
      sourceChannel: `@${this.botUsername || 'TelegramBot'} (用户私聊)`,
      targetPlatform: mode === 'both' ? 'telegram' : mode,
      originalText: content.text || (content.mediaFiles.length > 0 ? `[电报私聊提交 - 共 ${content.mediaFiles.length} 项媒体]` : '(Media Post)'),
      processedText: '正在由交互式机器人调度发布...',
      mediaCount: content.mediaFiles.length,
      status: 'processing'
    }
    appStore.addLog(logItem)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:log-added', logItem)
        }
      } catch {}
    })

    // 1. Dispatch to Telegram Channel
    if (mode === 'telegram' || mode === 'both') {
      const channelId = settings.defaultBotChatId || ''
      if (!channelId) {
        results.push('❌ Telegram 频道发布失败：未在 Rosetta 中配置默认目标频道 ID (如 @my_channel)。')
        hasFailure = true
      } else {
        const tgRes = await telegramBotDriver.sendPost({
          chatId: channelId,
          text: content.text,
          botToken: settings.defaultBotToken,
          mediaFiles: content.mediaFiles.map((m, idx) => ({
            dataBase64: `data:${m.mimeType};base64,${m.buffer.toString('base64')}`,
            name: m.name || `media_${idx}`,
            type: m.mimeType
          }))
        })

        if (tgRes.success) {
          results.push(`✅ <b>Telegram 频道已发送</b>\n频道目标：<code>${channelId}</code>\n直达链接：${tgRes.postUrl || '(已成功入频)'}`)
        } else {
          results.push(`❌ <b>Telegram 频道发送失败</b>\n原因：${tgRes.error}`)
          hasFailure = true
        }
      }
    }

    // 2. Dispatch to Twitter (X)
    if (mode === 'twitter' || mode === 'both') {
      const activeTwitterAccount = appStore.getAccounts().find((a) => a.platform === 'twitter' && a.status === 'active')
      if (!activeTwitterAccount) {
        results.push('❌ Twitter 发布失败：未在 Rosetta 中绑定活跃的 X / Twitter 账号。')
        hasFailure = true
      } else {
        try {
          // Upload media to Twitter in parallel
          const mediaIds: string[] = []
          for (const item of content.mediaFiles) {
            try {
              const upRes = await twitterDriver.uploadMedia(activeTwitterAccount, item.buffer, item.mimeType)
              if (upRes.success && upRes.mediaId) {
                mediaIds.push(upRes.mediaId)
              }
            } catch (err: any) {
              console.warn('[TelegramBotInteractive] Upload media to Twitter failed:', err)
            }
          }

          const publishRes = await twitterDriver.publishPostWithMedia(
            activeTwitterAccount,
            content.text,
            mediaIds,
            true
          )

          if (publishRes.success) {
            results.push(`✅ <b>Twitter (X) 推文已发布</b>\n账号：@${activeTwitterAccount.username}\n直达链接：${publishRes.url || '(发布成功)'}`)
          } else {
            results.push(`❌ <b>Twitter 发布失败</b>\n原因：${publishRes.error}`)
            hasFailure = true
          }
        } catch (err: any) {
          results.push(`❌ <b>Twitter 发布异常</b>\n原因：${err.message}`)
          hasFailure = true
        }
      }
    }

    // Complete log item in Rosetta
    const durationMs = Date.now() - startTime
    logItem.status = hasFailure ? 'failed' : 'success'
    logItem.durationMs = durationMs
    logItem.processedText = results.join('\n\n')
    appStore.addLog(logItem)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('mirror:log-added', logItem)
        }
      } catch {}
    })

    // Reply final result to user in Telegram Chat
    const finalReply = hasFailure
      ? `⚠️ <b>发布已完成 (部分失败)</b>\n\n${results.join('\n\n')}\n\n<i>发送 /start 可开启新的发帖。</i>`
      : `🎉 <b>恭喜！全部发布成功！</b>\n\n${results.join('\n\n')}\n\n<i>随时发送 /start 即可继续发布下一条。</i>`

    await this.sendMessage(baseUrl, fromId, finalReply, { parse_mode: 'HTML' })
  }

  private async sendMessage(baseUrl: string, chatId: number, text: string, extra: any = {}): Promise<void> {
    try {
      await fetch(`${baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...extra
        })
      })
    } catch (e: any) {
      console.warn('[TelegramBotInteractive] Send message failed:', e.message)
    }
  }

  private async downloadFileByFileId(token: string, fileId: string): Promise<Buffer | null> {
    try {
      const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
      const getFileData = (await getFileRes.json()) as any
      if (!getFileData.ok || !getFileData.result?.file_path) {
        return null
      }

      const filePath = getFileData.result.file_path
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
      const fileRes = await fetch(fileUrl)
      if (!fileRes.ok) return null

      const arrayBuffer = await fileRes.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (e: any) {
      console.warn('[TelegramBotInteractive] Download file failed:', e.message)
      return null
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

export const telegramBotInteractiveService = new TelegramBotInteractiveService()
