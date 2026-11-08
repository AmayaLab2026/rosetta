import { MirrorFilterConfig } from '../../shared/types'

export interface AttributionSource {
  username?: string
  name?: string
}

export class ContentPipeline {
  /**
   * Format attribution footer:
   * 1. Public username: "RT: t.me/xxx 西元YYYY年M月D日 HH:mm"
   * 2. No username (name only): "RT: <name> 西元YYYY年M月D日 HH:mm"
   */
  static formatAttribution(
    source: AttributionSource | string,
    style: 'RT' | 'from' | 'none' = 'RT',
    date: Date = new Date()
  ): string {
    if (style === 'none' || !source) return ''
    const prefix = style === 'from' ? '来自' : 'RT'

    let identifier = ''
    if (typeof source === 'string') {
      let clean = source.trim()
      clean = clean.replace(/^https?:\/\/t\.me\//i, 't.me/')
      if (clean.startsWith('@')) {
        identifier = `t.me/${clean.substring(1)}`
      } else {
        identifier = clean
      }
    } else {
      if (source.username) {
        let clean = source.username.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').trim()
        identifier = `t.me/${clean}`
      } else if (source.name) {
        // 没有公开发布用户名的，直接用用户名/频道名，不加 t.me/
        identifier = source.name.trim()
      }
    }

    if (!identifier) return ''

    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = String(date.getHours()).padStart(2, '0')
    const mins = String(date.getMinutes()).padStart(2, '0')
    return `${prefix}: ${identifier} 西元${year}年${month}月${day}日 ${hours}:${mins}`
  }

  /**
   * Process raw text from Telegram according to mirror filter rules
   */
  static process(
    rawText: string,
    config: MirrorFilterConfig,
    source?: AttributionSource | string,
    messageDate?: Date
  ): { text: string; shouldDrop: boolean } {
    let result = (rawText || '').trim()

    // 1. Check for drop/ad keywords
    if (config.stripAdKeywords && config.stripAdKeywords.length > 0) {
      for (const kw of config.stripAdKeywords) {
        if (kw.trim() && result.includes(kw.trim())) {
          // If the post has spam keywords, can either strip the keyword or drop
          // By default we remove the keyword or line containing it
          const regex = new RegExp(`.*${this.escapeRegex(kw.trim())}.*`, 'gi')
          result = result.replace(regex, '')
        }
      }
      result = result.trim()
    }

    // 2. Strip Telegram links
    if (config.removeTelegramLinks) {
      result = result.replace(/https?:\/\/t\.me\/[a-zA-Z0-9_+\/]+/gi, '')
    }

    // 3. Strip all other links
    if (config.removeOtherLinks) {
      result = result.replace(/https?:\/\/[^\s]+/gi, '')
    }

    // 4. Strip hashtags
    if (config.removeHashtags) {
      result = result.replace(/#[a-zA-Z0-9_\u4e00-\u9fa5]+/gi, '')
    }

    // 5. Custom replacements
    if (config.customReplacements && config.customReplacements.length > 0) {
      for (const item of config.customReplacements) {
        if (item.from) {
          result = result.split(item.from).join(item.to || '')
        }
      }
    }

    // 6. Clean up multiple blank lines
    result = result.replace(/\n{3,}/g, '\n\n').trim()

    // 7. Apply prefix and suffix
    if (config.prefix && result) {
      result = `${config.prefix.trim()}\n\n${result}`
    }
    if (config.suffix && result) {
      result = `${result}\n\n${config.suffix.trim()}`
    }

    // 8. Append attribution tag (RT: t.me/xxx or RT: Name 西元xxx)
    if (source && config.attributionStyle !== 'none') {
      const attribution = this.formatAttribution(
        source,
        config.attributionStyle || 'RT',
        messageDate || new Date()
      )
      if (attribution) {
        result = result ? `${result}\n\n${attribution}` : attribution
      }
    }

    if (!result) {
      return { text: '', shouldDrop: true }
    }

    return { text: result.trim(), shouldDrop: false }
  }

  /**
   * Split long text into Twitter thread chunks (<= 280 characters each)
   */
  static splitIntoThreadChunks(text: string, maxLen = 270): string[] {
    if (this.calculateTwitterLength(text) <= 280) {
      return [text]
    }

    const paragraphs = text.split('\n\n')
    const chunks: string[] = []
    let currentChunk = ''

    for (const para of paragraphs) {
      if (!currentChunk) {
        currentChunk = para
      } else if (this.calculateTwitterLength(`${currentChunk}\n\n${para}`) <= maxLen) {
        currentChunk += `\n\n${para}`
      } else {
        chunks.push(currentChunk)
        currentChunk = para
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk)
    }

    // If any individual chunk is still too long, split by sentences or characters
    const finalChunks: string[] = []
    for (const chunk of chunks) {
      if (this.calculateTwitterLength(chunk) <= maxLen) {
        finalChunks.push(chunk)
      } else {
        // split by sentence
        const lines = chunk.split('\n')
        let sub = ''
        for (const line of lines) {
          if (!sub) {
            sub = line
          } else if (this.calculateTwitterLength(`${sub}\n${line}`) <= maxLen) {
            sub += `\n${line}`
          } else {
            finalChunks.push(sub)
            sub = line
          }
        }
        if (sub) finalChunks.push(sub)
      }
    }

    // Append numbering if more than 1 chunk: (1/3), (2/3), etc.
    if (finalChunks.length > 1) {
      return finalChunks.map((c, i) => `${c}\n\n(${i + 1}/${finalChunks.length})`)
    }

    return finalChunks
  }

  /**
   * Twitter character count rules:
   * URL counts as 23 characters regardless of length.
   * CJK characters count as 2.
   * Latin / numbers count as 1.
   */
  static calculateTwitterLength(text: string): number {
    // Replace URLs with 23 placeholder characters
    const clean = text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23))
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

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
