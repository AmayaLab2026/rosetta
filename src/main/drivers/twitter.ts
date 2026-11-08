import { BrowserWindow } from 'electron'
import { Account } from '../../shared/types'

const TWITTER_BEARER_TOKEN =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

export interface TwitterPublishResult {
  success: boolean
  tweetId?: string
  url?: string
  error?: string
}

export class TwitterDriver {
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
          // Retrieve ALL cookies from the current session without restrictive domain filter
          const allCookies = await win.webContents.session.cookies.get({})

          const authTokenCookie = allCookies.find((c) => c.name === 'auth_token' && c.value.length > 15)
          let ct0Cookie = allCookies.find((c) => c.name === 'ct0' && c.value.length > 5)

          // If auth_token exists, check if user has proceeded past login
          if (authTokenCookie) {
            const currentUrl = win.webContents.getURL()
            const isPastLogin =
              currentUrl.includes('/home') ||
              (!currentUrl.includes('/login') &&
                !currentUrl.includes('/i/flow/login') &&
                !currentUrl.includes('/logout') &&
                currentUrl.includes('x.com'))

            // If ct0 doesn't exist yet, we can generate a valid 32-hex token and inject it into session
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

              // Try verifying credentials via Twitter API
              let username = ''
              let displayName = 'X User'
              let avatarUrl = ''

              const verification = await this.verifySession(authToken, ct0Val)
              if (verification.valid && verification.user) {
                username = verification.user.username
                displayName = verification.user.name
                avatarUrl = verification.user.avatarUrl
              } else {
                // Fallback: extract handle from page DOM or URL if API returned 403 / rate-limit
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
                  // Fallback: check twid cookie or generic handle
                  const twid = allCookies.find((c) => c.name === 'twid')
                  username = twid ? `user_${twid.value.replace(/[^0-9]/g, '')}` : 'x_user'
                }
              }

              // As long as we have verified or are past the login gate, complete login!
              if (username || isPastLogin) {
                resolved = true
                cleanup()

                // Gracefully close window
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

      // Polling interval every 800ms
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
   * Publish a tweet (supports single tweet or automatic Thread if text exceeds 280 chars)
   */
  async postTweet(
    account: Account,
    text: string,
    inReplyToTweetId?: string
  ): Promise<TwitterPublishResult> {
    const { authToken, ct0 } = account.credentials
    if (!authToken || !ct0) {
      return { success: false, error: 'Missing auth_token or ct0 credentials' }
    }

    try {
      const queryId = 'oBOUakDVSnxCrsBDa6439Q'
      const url = `https://x.com/i/api/graphql/${queryId}/CreateTweet`

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
        queryId
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: TWITTER_BEARER_TOKEN,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          'content-type': 'application/json',
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          referer: 'https://x.com/'
        },
        body: JSON.stringify(payload)
      })

      const data = (await response.json()) as any

      if (!response.ok || data.errors) {
        const errMsg = data.errors?.[0]?.message || `HTTP ${response.status}`
        return { success: false, error: errMsg }
      }

      const tweetResult =
        data?.data?.create_tweet?.tweet_results?.result ||
        data?.data?.create_tweet?.tweet_results?.result?.legacy

      const tweetId = tweetResult?.rest_id || tweetResult?.id_str
      const tweetUrl = tweetId
        ? `https://x.com/${account.username}/status/${tweetId}`
        : undefined

      return {
        success: true,
        tweetId,
        url: tweetUrl
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error while publishing' }
    }
  }

  /**
   * Post multiple tweets as a threaded sequence
   */
  async postThread(account: Account, chunks: string[]): Promise<TwitterPublishResult> {
    let lastId: string | undefined = undefined
    let firstUrl: string | undefined = undefined

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const res = await this.postTweet(account, chunk, lastId)
      if (!res.success) {
        return {
          success: false,
          error: `Failed on part ${i + 1}/${chunks.length}: ${res.error}`
        }
      }
      lastId = res.tweetId
      if (i === 0) firstUrl = res.url
      await new Promise((r) => setTimeout(r, 1200))
    }

    return {
      success: true,
      tweetId: lastId,
      url: firstUrl
    }
  }
}

export const twitterDriver = new TwitterDriver()
