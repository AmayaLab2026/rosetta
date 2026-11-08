import { BrowserWindow } from 'electron'
import { Account } from '../../shared/types'
import { generateTwitterTransactionId } from './twitter-transaction'

const TWITTER_BEARER_TOKEN =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const ACTIVE_QUERY_ID = 'UecQIuYzi2MCOah7-eOpcQ'
const DELETE_QUERY_ID = 'VaenaVgh5q5ih7kvyVjgtg'

export interface TwitterPublishResult {
  success: boolean
  tweetId?: string
  tweetIds?: string[]
  url?: string
  error?: string
}

export class TwitterDriver {
  /**
   * Generate x-client-transaction-id for GraphQL requests
   */
  private async getTransactionId(method: string, path: string): Promise<string> {
    return generateTwitterTransactionId(method, path)
  }

  /**
   * Verify Twitter credentials and fetch user profile
   */
  async verifySession(
    authToken: string,
    ct0: string
  ): Promise<{ valid: boolean; user?: { username: string; name: string; avatarUrl: string }; error?: string }> {
    try {
      const response = await fetch('https://api.twitter.com/1.1/account/verify_credentials.json', {
        method: 'GET',
        headers: {
          authorization: TWITTER_BEARER_TOKEN,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          referer: 'https://x.com/'
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { valid: false, error: `Twitter HTTP ${response.status}: ${errorText.slice(0, 100)}` }
      }

      const data = (await response.json()) as any
      return {
        valid: true,
        user: {
          username: data.screen_name,
          name: data.name,
          avatarUrl: data.profile_image_url_https
        }
      }
    } catch (err: any) {
      return { valid: false, error: err.message || 'Connection failed' }
    }
  }

  /**
   * Interactive Login Window: opens browser window, auto-captures cookies immediately when logged in
   */
  async interactiveLogin(): Promise<{ success: boolean; account?: Partial<Account>; error?: string }> {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 620,
        height: 760,
        title: 'Sign in to X / Twitter — Rosetta Auto-Capture Enabled',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      let resolved = false
      let checkLock = false

      const cleanup = () => {
        clearInterval(intervalId)
        try {
          win.webContents.session.cookies.removeListener('changed', cookieListener)
        } catch {
          // ignore
        }
      }

      const checkCookies = async () => {
        if (resolved || checkLock || win.isDestroyed()) return
        checkLock = true

        try {
          const allCookies = await win.webContents.session.cookies.get({})
          const authTokenCookie = allCookies.find((c) => c.name === 'auth_token' && c.value.length > 15)
          let ct0Cookie = allCookies.find((c) => c.name === 'ct0' && c.value.length > 5)

          if (authTokenCookie) {
            const currentUrl = win.webContents.getURL()
            const isPastLogin =
              currentUrl.includes('/home') ||
              (!currentUrl.includes('/login') &&
                !currentUrl.includes('/i/flow/login') &&
                !currentUrl.includes('/logout') &&
                currentUrl.includes('x.com'))

            let ct0Val = ct0Cookie?.value
            if (!ct0Val && isPastLogin) {
              ct0Val = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
              await win.webContents.session.cookies.set({
                url: 'https://x.com',
                name: 'ct0',
                value: ct0Val,
                domain: '.x.com',
                path: '/',
                secure: true
              })
            }

            if (ct0Val) {
              const authToken = authTokenCookie.value

              let username = ''
              let displayName = 'X User'
              let avatarUrl = ''

              const verification = await this.verifySession(authToken, ct0Val)
              if (verification.valid && verification.user) {
                username = verification.user.username
                displayName = verification.user.name
                avatarUrl = verification.user.avatarUrl
              } else {
                try {
                  const domProfile = await win.webContents.executeJavaScript(`
                    (() => {
                      try {
                        const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
                        const href = link ? link.getAttribute('href') : '';
                        const img = link ? link.querySelector('img') : null;
                        const handle = href ? href.replace(/^\\//, '') : '';
                        return { handle, avatar: img ? img.src : '' };
                      } catch {
                        return null;
                      }
                    })()
                  `)
                  if (domProfile?.handle) {
                    username = domProfile.handle
                    displayName = domProfile.handle
                    avatarUrl = domProfile.avatar || ''
                  }
                } catch {
                  // ignore
                }

                if (!username && isPastLogin) {
                  const twid = allCookies.find((c) => c.name === 'twid')
                  username = twid ? `user_${twid.value.replace(/[^0-9]/g, '')}` : 'x_user'
                }
              }

              if (username || isPastLogin) {
                resolved = true
                cleanup()

                setTimeout(() => {
                  try {
                    if (!win.isDestroyed()) win.close()
                  } catch {
                    // ignore
                  }
                }, 300)

                resolve({
                  success: true,
                  account: {
                    platform: 'twitter',
                    username: username || 'x_user',
                    displayName: displayName || username || 'X User',
                    avatarUrl,
                    status: 'active',
                    credentials: {
                      authToken,
                      ct0: ct0Val
                    }
                  }
                })
                return
              }
            }
          }
        } catch (e) {
          console.error('[TwitterDriver] Error checking cookies:', e)
        } finally {
          checkLock = false
        }
      }

      const cookieListener = (_event: any, cookie: any) => {
        if (cookie.name === 'auth_token' || cookie.name === 'ct0') {
          checkCookies()
        }
      }

      win.webContents.session.cookies.on('changed', cookieListener)
      win.webContents.on('did-finish-load', checkCookies)
      win.webContents.on('did-navigate', checkCookies)
      win.webContents.on('did-navigate-in-page', checkCookies)

      const intervalId = setInterval(checkCookies, 800)

      win.on('closed', () => {
        cleanup()
        if (!resolved) {
          resolve({ success: false, error: 'Login window closed by user' })
        }
      })

      win.loadURL('https://x.com/login')
    })
  }

  /**
   * Upload an image to Twitter/X (simple upload endpoint for media < 5MB)
   */
  async uploadMedia(
    account: Account,
    mediaData: Buffer | Uint8Array | string
  ): Promise<{ success: boolean; mediaId?: string; error?: string }> {
    const { authToken, ct0 } = account.credentials
    if (!authToken || !ct0) {
      return { success: false, error: 'Missing auth credentials' }
    }

    try {
      const base64Str =
        typeof mediaData === 'string'
          ? mediaData.replace(/^data:image\/\w+;base64,/, '')
          : Buffer.from(mediaData).toString('base64')

      const formData = new URLSearchParams()
      formData.append('media_data', base64Str)

      const response = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
        method: 'POST',
        headers: {
          authorization: TWITTER_BEARER_TOKEN,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          referer: 'https://x.com/'
        },
        body: formData
      })

      if (!response.ok) {
        const errText = await response.text()
        return { success: false, error: `Upload HTTP ${response.status}: ${errText.slice(0, 100)}` }
      }

      const data = (await response.json()) as any
      const mediaId = data.media_id_string || (data.media_id ? String(data.media_id) : undefined)
      if (!mediaId) {
        return { success: false, error: 'Failed to retrieve media_id from Twitter' }
      }

      console.log(`[TwitterDriver] Uploaded media successfully, mediaId: ${mediaId}`)
      return { success: true, mediaId }
    } catch (err: any) {
      return { success: false, error: err.message || 'Media upload failed' }
    }
  }

  /**
   * Post a tweet using reverse-engineered GraphQL API with dynamic x-client-transaction-id
   */
  async postTweet(
    account: Account,
    text: string,
    inReplyToTweetId?: string,
    mediaIds?: string[]
  ): Promise<TwitterPublishResult> {
    const { authToken, ct0 } = account.credentials
    if (!authToken || !ct0) {
      return { success: false, error: 'Missing auth_token or ct0 credentials' }
    }

    try {
      const path = `/i/api/graphql/${ACTIVE_QUERY_ID}/CreateTweet`
      const url = `https://x.com${path}`

      // Generate dynamic x-client-transaction-id
      let transactionId = ''
      try {
        transactionId = await this.getTransactionId('POST', path)
      } catch (e) {
        console.warn('[TwitterDriver] Transaction ID generation failed, attempting without:', e)
      }

      const payload = {
        variables: {
          tweet_text: text,
          dark_request: false,
          ...(inReplyToTweetId
            ? {
                reply: {
                  in_reply_to_tweet_id: inReplyToTweetId,
                  exclude_reply_user_ids: []
                }
              }
            : {}),
          ...(mediaIds && mediaIds.length > 0
            ? {
                media: {
                  media_entities: mediaIds.map((id) => ({ media_id: id, tagged_users: [] })),
                  possibly_sensitive: false
                }
              }
            : {})
        },
        features: {
          communities_web_enable_tweet_community_results_fetch: true,
          crossposting_ff_enable: true,
          tweetypie_unmention_optimization_enabled: true,
          responsive_web_edit_tweet_api_enabled: true,
          graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
          view_counts_everywhere_api_enabled: true,
          longform_notetweets_consumption_enabled: true,
          responsive_web_twitter_article_tweet_consumption_enabled: true,
          tweet_awards_web_tipping_enabled: false,
          creator_subscriptions_quote_tweet_preview_enabled: false,
          freedom_of_speech_not_reach_fetch_enabled: true,
          standardized_nudges_misinfo: true,
          tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
          rweb_video_timestamps_enabled: true,
          longform_notetweets_rich_text_read_enabled: true,
          longform_notetweets_inline_media_enabled: true,
          responsive_web_enhance_cards_enabled: false
        },
        queryId: ACTIVE_QUERY_ID
      }

      const headers: Record<string, string> = {
        authorization: TWITTER_BEARER_TOKEN,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'content-type': 'application/json',
        cookie: `auth_token=${authToken}; ct0=${ct0}`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        referer: 'https://x.com/'
      }

      if (transactionId) {
        headers['x-client-transaction-id'] = transactionId
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const data = (await response.json()) as any
      if (data.errors && data.errors.length > 0) {
        return { success: false, error: data.errors[0]?.message || 'GraphQL error' }
      }

      const tweetResult =
        data?.data?.create_tweet?.tweet_results?.result ||
        data?.data?.create_tweet?.tweet_results?.result?.legacy

      const tweetId = tweetResult?.rest_id || tweetResult?.id_str

      if (!tweetId) {
        // Twitter dropped the request (e.g. anti-bot dropped transactionId)
        console.warn('[TwitterDriver] Empty tweet_results, falling back to background browser post...')
        return this.postViaHeadless(account, text)
      }

      const directUrl = `https://x.com/${account.username}/status/${tweetId}`
      console.log('[TwitterDriver] Tweet successfully published! URL:', directUrl)

      return {
        success: true,
        tweetId,
        tweetIds: [tweetId],
        url: directUrl
      }
    } catch (err: any) {
      console.error('[TwitterDriver] Direct API post failed, falling back to headless:', err)
      return this.postViaHeadless(account, text)
    }
  }

  /**
   * Headless Fallback: Posts tweet using a background invisible Electron browser window
   */
  async postViaHeadless(account: Account, text: string): Promise<TwitterPublishResult> {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 650,
        height: 750,
        show: false, // completely hidden in background
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      let resolved = false
      let detectedTweetId: string | undefined = undefined

      const cleanup = () => {
        clearTimeout(timer)
        setTimeout(() => {
          try {
            if (!win.isDestroyed()) win.destroy()
          } catch {}
        }, 1500)
      }

      const finishSuccess = (id?: string) => {
        if (resolved) return
        resolved = true

        const finalId = id || detectedTweetId
        const directUrl = finalId
          ? `https://x.com/${account.username}/status/${finalId}`
          : `https://x.com/${account.username}`

        cleanup()
        resolve({
          success: true,
          tweetId: finalId,
          url: directUrl
        })
      }

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          resolve({ success: false, error: 'Background post timed out' })
        }
      }, 30000)

      // 1. CDP Debugger interception of response body
      try {
        win.webContents.debugger.attach('1.3')
        win.webContents.debugger.sendCommand('Network.enable')
        win.webContents.debugger.on('message', async (_event, method, params) => {
          if (method === 'Network.responseReceived') {
            const url = params?.response?.url || ''
            if (url.includes('CreateTweet') && params?.response?.status === 200) {
              try {
                const bodyObj = await win.webContents.debugger.sendCommand('Network.getResponseBody', {
                  requestId: params.requestId
                })
                const json = JSON.parse(bodyObj.body)
                const tid =
                  json?.data?.create_tweet?.tweet_results?.result?.rest_id ||
                  json?.data?.create_tweet?.tweet_results?.result?.legacy?.id_str
                if (tid) {
                  detectedTweetId = tid
                  finishSuccess(tid)
                }
              } catch (e) {
                // ignore
              }
            }
          }
        })
      } catch (e) {
        // ignore
      }

      // 2. Fill text and click Tweet button
      win.webContents.on('did-finish-load', async () => {
        try {
          await win.webContents.executeJavaScript(`
            (async () => {
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              for (let i = 0; i < 40; i++) {
                const editor = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                               document.querySelector('[role="textbox"][contenteditable="true"]');
                if (editor) {
                  editor.focus();
                  document.execCommand('insertText', false, ${JSON.stringify(text)});
                  await sleep(600);
                  const btn = document.querySelector('[data-testid="tweetButton"]') ||
                              document.querySelector('[data-testid="tweetButtonInline"]');
                  if (btn && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
                    btn.click();
                    break;
                  }
                }
                await sleep(300);
              }

              // Poll for toast / status link or intercepted fetch ID in DOM
              for (let j = 0; j < 30; j++) {
                const toastLink = document.querySelector('a[href*="/status/"]');
                if (toastLink) {
                  const href = toastLink.getAttribute('href');
                  const m = href.match(/status\\/(\\d+)/);
                  if (m) return { tweetId: m[1] };
                }
                await sleep(200);
              }
              return null;
            })()
          `).then((domRes: any) => {
            if (domRes?.tweetId) {
              detectedTweetId = domRes.tweetId
              finishSuccess(domRes.tweetId)
            }
          }).catch(() => {})
        } catch (e) {
          // ignore
        }
      })

      win.loadURL('https://x.com/compose/post')
    })
  }

  /**
   * Post multiple tweets as a threaded sequence
   */
  async postThread(account: Account, chunks: string[], mediaIds?: string[]): Promise<TwitterPublishResult> {
    let lastId: string | undefined = undefined
    let firstUrl: string | undefined = undefined
    const allTweetIds: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkMedia = i === 0 ? mediaIds : undefined
      const res = await this.postTweet(account, chunk, lastId, chunkMedia)
      if (!res.success) {
        return {
          success: false,
          tweetIds: allTweetIds,
          error: `Failed on part ${i + 1}/${chunks.length}: ${res.error}`
        }
      }
      lastId = res.tweetId
      if (res.tweetId) allTweetIds.push(res.tweetId)
      if (i === 0) firstUrl = res.url
      await new Promise((r) => setTimeout(r, 1200))
    }

    return {
      success: true,
      tweetId: lastId,
      tweetIds: allTweetIds,
      url: firstUrl
    }
  }

  /**
   * Delete a tweet by ID using GraphQL mutation
   */
  async deleteTweet(account: Account, tweetId: string): Promise<{ success: boolean; error?: string }> {
    const { authToken, ct0 } = account.credentials
    if (!authToken || !ct0) {
      return { success: false, error: 'Missing auth_token or ct0 credentials' }
    }

    try {
      const path = `/i/api/graphql/${DELETE_QUERY_ID}/DeleteTweet`
      const url = `https://x.com${path}`

      const payload = {
        variables: {
          tweet_id: tweetId,
          dark_request: false
        },
        queryId: DELETE_QUERY_ID
      }

      const headers: Record<string, string> = {
        authorization: TWITTER_BEARER_TOKEN,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'content-type': 'application/json',
        cookie: `auth_token=${authToken}; ct0=${ct0}`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        referer: 'https://x.com/'
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const data = (await response.json()) as any
      if (data.errors && data.errors.length > 0) {
        return { success: false, error: data.errors[0]?.message || 'Delete tweet failed' }
      }

      console.log(`[TwitterDriver] Tweet ${tweetId} deleted successfully from X`)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error deleting tweet' }
    }
  }

  /**
   * Delete multiple tweets (e.g. all tweets in a mirrored thread)
   */
  async deleteThread(
    account: Account,
    tweetIds: string[]
  ): Promise<{ success: boolean; deletedCount: number; errors: string[] }> {
    let deletedCount = 0
    const errors: string[] = []

    for (const tid of tweetIds) {
      const res = await this.deleteTweet(account, tid)
      if (res.success) {
        deletedCount++
      } else if (res.error) {
        errors.push(`Tweet ${tid}: ${res.error}`)
      }
      await new Promise((r) => setTimeout(r, 600))
    }

    return {
      success: errors.length === 0,
      deletedCount,
      errors
    }
  }

  /**
   * Check if a tweet exists on Twitter (returns false if 404/deleted)
   */
  async checkTweetExists(account: Account, tweetId: string): Promise<boolean> {
    try {
      const res = await fetch(`https://x.com/${account.username}/status/${tweetId}`, {
        method: 'HEAD',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        }
      })
      if (res.status === 404) {
        return false
      }
      return true
    } catch {
      return true
    }
  }
}

export const twitterDriver = new TwitterDriver()
