import { appStore } from '../storage/store'
import { telegramMirrorService } from '../mirror/telegram-listener'
import { TelegramBotPostItem, TelegramBotSendPayload } from '../../shared/types'

export class TelegramBotDriver {
  /**
   * Verify Telegram Bot Token and retrieve real Bot identity & avatar via getMe and public CDN
   */
  async verifyBotToken(token: string): Promise<{
    valid: boolean
    botName?: string
    username?: string
    avatarUrl?: string
    error?: string
  }> {
    if (!token || !token.trim()) {
      return { valid: false, error: 'Token is empty' }
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`)
      const data = (await res.json()) as any
      if (data.ok && data.result) {
        const botName = data.result.first_name || 'Rosetta Bot'
        const username = data.result.username || ''

        let avatarUrl: string | undefined = undefined
        if (username) {
          try {
            const avatarRes = await fetch(`https://t.me/i/userpic/320/${username}.jpg`, {
              signal: AbortSignal.timeout(5000)
            })
            if (avatarRes.ok) {
              const buf = Buffer.from(await avatarRes.arrayBuffer())
              if (buf.length > 0) {
                avatarUrl = `data:image/jpeg;base64,${buf.toString('base64')}`
              }
            }
          } catch (e: any) {
            console.warn('[TelegramBotDriver] Could not download avatar data URL, using direct URL:', e.message)
            avatarUrl = `https://t.me/i/userpic/320/${username}.jpg`
          }
        }

        return {
          valid: true,
          botName,
          username,
          avatarUrl
        }
      }
      return { valid: false, error: data.description || 'Invalid Bot Token' }
    } catch (e: any) {
      return { valid: false, error: e.message || 'Network request failed' }
    }
  }

  /**
   * Send text, photo, video, or multi-media album via official Telegram Bot API (server logic)
   */
  async sendPost(payload: TelegramBotSendPayload): Promise<{
    success: boolean
    messageId?: number
    postUrl?: string
    error?: string
  }> {
    const settings = appStore.getSettings()
    const token = (payload.botToken || settings.defaultBotToken || '').trim()
    const targetChatId = (payload.chatId || settings.defaultBotChatId || '').trim()

    if (!token) {
      return { success: false, error: 'Telegram Bot Token is required. Please configure it in Bot Settings.' }
    }
    if (!targetChatId) {
      return { success: false, error: 'Target Chat ID or @channel is required.' }
    }

    const cleanChatId = targetChatId
    const cleanText = (payload.text || '').trim()
    const mediaFiles = payload.mediaFiles || []
    const hasMedia = mediaFiles.length > 0
    const baseUrl = `https://api.telegram.org/bot${token}`

    try {
      let sentMessageId: number | undefined
      let mediaType: 'none' | 'photo' | 'video' | 'album' = 'none'

      const formatTelegramError = (errDesc: string) => {
        let errMsg = errDesc || 'Telegram Bot API 响应失败'
        if (errMsg.includes('chat not found')) {
          errMsg = `未找到目标频道/群组 "${cleanChatId}"，请确认频道用户名是否正确（如 @channel_name 或 -100...），或先将机器人添加进该频道。`
        } else if (errMsg.includes('bot is not a member') || errMsg.includes('need administrator') || errMsg.includes('CHAT_ADMIN_REQUIRED')) {
          errMsg = `机器人不是频道 "${cleanChatId}" 的管理员，请在频道管理设置中将机器人设为管理员并赋予发帖与删帖权限。`
        } else if (errMsg.includes('Unauthorized')) {
          errMsg = 'Bot Token 无效或未授权，请核对来自 @BotFather 的 Token。'
        } else if (errMsg.includes('caption is too long')) {
          errMsg = '图文说明文本超过了 Telegram 1024 字符限制。'
        }
        return errMsg
      }

      const safeCaption = cleanText.length > 1024 ? cleanText.substring(0, 1020) + '...' : cleanText

      if (!hasMedia) {
        // Plain text message
        const res = await fetch(`${baseUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: cleanChatId,
            text: cleanText,
            parse_mode: 'HTML'
          })
        })

        let data = (await res.json()) as any
        if (!data.ok) {
          // Retry without HTML parse_mode in case formatting is invalid
          const retryRes = await fetch(`${baseUrl}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: cleanChatId,
              text: cleanText
            })
          })
          data = await retryRes.json()
        }

        if (!data.ok) {
          return { success: false, error: formatTelegramError(data.description) }
        }
        sentMessageId = data.result?.message_id
      } else if (mediaFiles.length === 1) {
        const file = mediaFiles[0]
        const isVideo = file.type.startsWith('video/')
        mediaType = isVideo ? 'video' : 'photo'
        const endpoint = isVideo ? 'sendVideo' : 'sendPhoto'
        const fieldName = isVideo ? 'video' : 'photo'

        const rawBase64 = file.dataBase64.replace(/^data:[^;]+;base64,/, '')
        const buffer = Buffer.from(rawBase64, 'base64')

        const form = new FormData()
        form.append('chat_id', cleanChatId)
        if (safeCaption) form.append('caption', safeCaption)
        form.append(
          fieldName,
          new Blob([buffer], { type: file.type || (isVideo ? 'video/mp4' : 'image/jpeg') }),
          file.name || (isVideo ? 'video.mp4' : 'image.jpg')
        )

        const res = await fetch(`${baseUrl}/${endpoint}`, {
          method: 'POST',
          body: form
        })
        const data = (await res.json()) as any
        if (!data.ok) {
          return { success: false, error: formatTelegramError(data.description) }
        }
        sentMessageId = data.result?.message_id
      } else {
        // Multiple media files: send as native Telegram MediaGroup album
        mediaType = 'album'
        const form = new FormData()
        form.append('chat_id', cleanChatId)

        const mediaMetadata: any[] = []

        for (let i = 0; i < mediaFiles.length; i++) {
          const file = mediaFiles[i]
          const isVideo = file.type.startsWith('video/')
          const rawBase64 = file.dataBase64.replace(/^data:[^;]+;base64,/, '')
          const buffer = Buffer.from(rawBase64, 'base64')
          const attachName = `file_${i}`

          mediaMetadata.push({
            type: isVideo ? 'video' : 'photo',
            media: `attach://${attachName}`,
            caption: i === 0 && safeCaption ? safeCaption : undefined
          })

          form.append(
            attachName,
            new Blob([buffer], { type: file.type || (isVideo ? 'video/mp4' : 'image/jpeg') }),
            file.name || (isVideo ? `video_${i}.mp4` : `image_${i}.jpg`)
          )
        }

        form.append('media', JSON.stringify(mediaMetadata))

        const res = await fetch(`${baseUrl}/sendMediaGroup`, {
          method: 'POST',
          body: form
        })
        const data = (await res.json()) as any
        if (!data.ok) {
          return { success: false, error: formatTelegramError(data.description) }
        }
        const results = Array.isArray(data.result) ? data.result : [data.result]
        sentMessageId = results[0]?.message_id
      }

      if (!sentMessageId) {
        return { success: false, error: 'Message sent but failed to obtain message_id' }
      }

      const postUrl = this.formatTelegramUrl(cleanChatId, sentMessageId)

      // Suppress echo loop in mirror listener so dual-broadcast doesn't post duplicate tweets
      telegramMirrorService.markSelfSentMessage(cleanChatId, sentMessageId, cleanText)

      // Save to bot posts history for one-click revocation
      appStore.saveBotPost({
        id: `bot_post_${Date.now()}_${sentMessageId}`,
        messageId: sentMessageId,
        chatId: cleanChatId,
        text: cleanText || (hasMedia ? `[多媒体消息 - 共 ${mediaFiles.length} 项]` : '(Media Message)'),
        mediaType,
        mediaCount: mediaFiles.length,
        sentAt: new Date().toISOString(),
        status: 'sent',
        postUrl
      })

      console.log(`[TelegramBot] Post sent via Bot API to ${cleanChatId}, messageId: #${sentMessageId}`)
      return { success: true, messageId: sentMessageId, postUrl }
    } catch (err: any) {
      console.error('[TelegramBot] Bot API error:', err)
      return { success: false, error: err.message || 'Telegram Bot API network failure' }
    }
  }

  /**
   * Remote delete / revoke a message by chatId and messageId using official Bot API
   */
  async deletePost(params: {
    chatId: string
    messageId: number
    botToken?: string
  }): Promise<{ success: boolean; error?: string }> {
    const settings = appStore.getSettings()
    const token = (params.botToken || settings.defaultBotToken || '').trim()
    const { chatId, messageId } = params

    if (!token) {
      return { success: false, error: 'Telegram Bot Token is required to revoke messages' }
    }
    if (!chatId || !messageId) {
      return { success: false, error: 'Chat ID and Message ID are required' }
    }

    const cleanChatId = chatId.trim()
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: cleanChatId,
          message_id: messageId
        })
      })
      const data = (await res.json()) as any
      if (data.ok) {
        appStore.updateBotPostStatus(cleanChatId, messageId, 'deleted')
        console.log(`[TelegramBot] Deleted message #${messageId} in ${cleanChatId} via Bot API`)
        return { success: true }
      } else {
        return { success: false, error: data.description || 'Bot API deleteMessage rejected (Check bot admin permissions in channel)' }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Bot API network error on delete' }
    }
  }

  private formatTelegramUrl(chatId: string, messageId: number): string {
    if (chatId.startsWith('@')) {
      return `https://t.me/${chatId.replace(/^@/, '')}/${messageId}`
    }
    if (chatId.startsWith('-100')) {
      return `https://t.me/c/${chatId.replace(/^-100/, '')}/${messageId}`
    }
    return `https://t.me/${chatId}/${messageId}`
  }
}

export const telegramBotDriver = new TelegramBotDriver()
