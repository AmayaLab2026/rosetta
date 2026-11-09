import { appStore } from '../storage/store'
import { telegramMirrorService } from '../mirror/telegram-listener'
import { TelegramBotPostItem, TelegramBotSendPayload } from '../../shared/types'
import { CustomFile } from 'telegram/client/uploads'

export class TelegramBotDriver {
  /**
   * Send text, photo, video, or multi-media album via Telegram Bot API or MTProto
   */
  async sendPost(payload: TelegramBotSendPayload): Promise<{
    success: boolean
    messageId?: number
    postUrl?: string
    error?: string
  }> {
    const { chatId, text, botToken, useMtproto, mediaFiles } = payload
    if (!chatId.trim()) {
      return { success: false, error: 'Target Chat ID or @channel is required' }
    }

    const cleanChatId = chatId.trim()
    const cleanText = (text || '').trim()
    const hasMedia = mediaFiles && mediaFiles.length > 0

    // Mode 1: Telegram Bot API (HTTP / HTTPS)
    if (botToken && botToken.trim() && !useMtproto) {
      const token = botToken.trim()
      const baseUrl = `https://api.telegram.org/bot${token}`

      try {
        let sentMessageId: number | undefined
        let mediaType: 'none' | 'photo' | 'video' | 'album' = 'none'

        if (!hasMedia) {
          // Send plain text
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
            // Retry without parse_mode in case HTML formatting is invalid
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
            return { success: false, error: data.description || 'Bot API sendMessage failed' }
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
          if (cleanText) form.append('caption', cleanText)
          form.append(fieldName, new Blob([buffer], { type: file.type }), file.name || (isVideo ? 'video.mp4' : 'image.jpg'))

          const res = await fetch(`${baseUrl}/${endpoint}`, {
            method: 'POST',
            body: form
          })
          const data = (await res.json()) as any
          if (!data.ok) {
            return { success: false, error: data.description || `Bot API ${endpoint} failed` }
          }
          sentMessageId = data.result?.message_id
        } else {
          // Multi-media album (sendMediaGroup)
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
              caption: i === 0 && cleanText ? cleanText : undefined
            })

            form.append(attachName, new Blob([buffer], { type: file.type }), file.name || (isVideo ? `video_${i}.mp4` : `image_${i}.jpg`))
          }

          form.append('media', JSON.stringify(mediaMetadata))

          const res = await fetch(`${baseUrl}/sendMediaGroup`, {
            method: 'POST',
            body: form
          })
          const data = (await res.json()) as any
          if (!data.ok) {
            return { success: false, error: data.description || 'Bot API sendMediaGroup failed' }
          }
          const results = Array.isArray(data.result) ? data.result : [data.result]
          sentMessageId = results[0]?.message_id
        }

        if (!sentMessageId) {
          return { success: false, error: 'Message sent but failed to obtain message_id' }
        }

        const postUrl = this.formatTelegramUrl(cleanChatId, sentMessageId)

        // Save to bot posts history
        appStore.saveBotPost({
          id: `bot_post_${Date.now()}_${sentMessageId}`,
          messageId: sentMessageId,
          chatId: cleanChatId,
          text: cleanText || (hasMedia ? `[多媒体消息 - 共 ${mediaFiles!.length} 项]` : '(Media Message)'),
          mediaType,
          mediaCount: mediaFiles?.length || 0,
          sentAt: new Date().toISOString(),
          status: 'sent',
          postUrl
        })

        console.log(`[TelegramBot] Post sent successfully to ${cleanChatId}, messageId: #${sentMessageId}`)
        return { success: true, messageId: sentMessageId, postUrl }
      } catch (err: any) {
        console.error('[TelegramBot] Bot API error:', err)
        return { success: false, error: err.message || 'Telegram Bot API network failure' }
      }
    }

    // Mode 2: Native MTProto Client
    const client = telegramMirrorService.getClient()
    if (!client || !telegramMirrorService.getStatus().running) {
      return {
        success: false,
        error: botToken
          ? 'Bot API 发送失败，且 Telegram MTProto 客户端未连接。'
          : '未提供 Bot Token，且 Telegram MTProto 监听客户端未连接。请提供 Bot Token 或在「账号」页登录 Telegram。'
      }
    }

    try {
      let peer: any = cleanChatId
      if (/^-?\d+$/.test(cleanChatId)) {
        peer = await client.getInputEntity(cleanChatId)
      }

      let sentMessageId: number | undefined
      let mediaType: 'none' | 'photo' | 'video' | 'album' = 'none'

      if (!hasMedia) {
        const msg: any = await client.sendMessage(peer, { message: cleanText })
        sentMessageId = msg?.id
      } else if (mediaFiles.length === 1) {
        const file = mediaFiles[0]
        const isVideo = file.type.startsWith('video/')
        mediaType = isVideo ? 'video' : 'photo'
        const rawBase64 = file.dataBase64.replace(/^data:[^;]+;base64,/, '')
        const buffer = Buffer.from(rawBase64, 'base64')
        const customFile = new CustomFile(file.name || (isVideo ? 'video.mp4' : 'image.jpg'), buffer.length, '', buffer)

        const msg: any = await client.sendFile(peer, {
          file: customFile,
          caption: cleanText || undefined,
          videoNote: false,
          supportsStreaming: isVideo
        })
        sentMessageId = msg?.id
      } else {
        mediaType = 'album'
        const customFiles = mediaFiles.map((file, idx) => {
          const rawBase64 = file.dataBase64.replace(/^data:[^;]+;base64,/, '')
          const buffer = Buffer.from(rawBase64, 'base64')
          return new CustomFile(file.name || `media_${idx}`, buffer.length, '', buffer)
        })

        const msgs: any = await client.sendFile(peer, {
          file: customFiles,
          caption: cleanText || undefined
        })
        const firstMsg = Array.isArray(msgs) ? msgs[0] : msgs
        sentMessageId = firstMsg?.id
      }

      if (!sentMessageId) {
        return { success: false, error: 'MTProto sent message but could not resolve message ID' }
      }

      const postUrl = this.formatTelegramUrl(cleanChatId, sentMessageId)

      appStore.saveBotPost({
        id: `bot_post_${Date.now()}_${sentMessageId}`,
        messageId: sentMessageId,
        chatId: cleanChatId,
        text: cleanText || (hasMedia ? `[多媒体消息 - 共 ${mediaFiles!.length} 项]` : '(Media Message)'),
        mediaType,
        mediaCount: mediaFiles?.length || 0,
        sentAt: new Date().toISOString(),
        status: 'sent',
        postUrl
      })

      console.log(`[TelegramBot] Post sent via MTProto to ${cleanChatId}, messageId: #${sentMessageId}`)
      return { success: true, messageId: sentMessageId, postUrl }
    } catch (err: any) {
      console.error('[TelegramBot] MTProto send error:', err)
      return { success: false, error: err.message || 'Telegram MTProto send error' }
    }
  }

  /**
   * Delete a message by chatId and messageId
   */
  async deletePost(params: {
    chatId: string
    messageId: number
    botToken?: string
    useMtproto?: boolean
  }): Promise<{ success: boolean; error?: string }> {
    const { chatId, messageId, botToken, useMtproto } = params
    if (!chatId || !messageId) {
      return { success: false, error: 'Chat ID and Message ID are required' }
    }

    const cleanChatId = chatId.trim()

    // Mode 1: Bot API deleteMessage
    if (botToken && botToken.trim() && !useMtproto) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken.trim()}/deleteMessage`, {
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
          return { success: false, error: data.description || 'Bot API deleteMessage rejected' }
        }
      } catch (err: any) {
        return { success: false, error: err.message || 'Bot API network error on delete' }
      }
    }

    // Mode 2: MTProto delete
    try {
      const deleted = await telegramMirrorService.deleteTelegramMessage(cleanChatId, messageId)
      if (deleted) {
        appStore.updateBotPostStatus(cleanChatId, messageId, 'deleted')
        return { success: true }
      } else {
        return { success: false, error: 'MTProto deleteMessage failed or message not found' }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'MTProto delete error' }
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
