import { BrowserWindow } from 'electron'
import { Account } from '../../shared/types'

const TWITTER_BEARER_TOKEN =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// Candidate GraphQL query IDs for CreateTweet (ordered by recency)
const CANDIDATE_QUERY_IDS = [
  'UecQIuYzi2MCOah7-eOpcQ',
  'jm93VcEnLxM7My_CL9C_EA',
  '5V_dkq1kcR8SwnPyEPuzGw',
  'SiM_cAu83R0wnrpmKQQSEw'
]

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
   * Fetch latest tweet ID for an account from user timeline
   */
  async fetchLatestTweetId(account: Account): Promise<string | undefined> {
    try {
      const response = await fetch(
        `https://api.twitter.com/1.1/statuses/user_timeline.json?screen_name=${account.username}&count=1`,
        {
          method: 'GET',
          headers: {
            authorization: TWITTER_BEARER_TOKEN,
            'x-csrf-token': account.credentials.ct0 || '',
            cookie: `auth_token=${account.credentials.authToken}; ct0=${account.credentials.ct0}`,
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
          }
        }
      )
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data) && data.length > 0 && data[0].id_str) {
          return data[0].id_str
        }
      }
    } catch {
      // ignore
    }
    return undefined
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
   * Post a tweet via Twitter GraphQL API with automatic fallback to headless browser
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

    // 1. Try candidate GraphQL query IDs via fast API
    for (const queryId of CANDIDATE_QUERY_IDS) {
      const apiResult = await this.tryApiCreateTweet(account, queryId, text, inReplyToTweetId)
      if (apiResult.success) {
        return apiResult
      }
      console.warn(`[TwitterDriver] QueryId ${queryId} response: ${apiResult.error}, checking next...`)
    }

    // 2. Fallback: Post via background headless browser window with direct tweetId extraction
    console.log('[TwitterDriver] Fast API unavailable, using background browser automation...')
    return this.postViaHeadless(account, text)
  }

  /**
   * Internal attempt to call GraphQL CreateTweet
   */
  private async tryApiCreateTweet(
    account: Account,
    queryId: string,
    text: string,
    inReplyToTweetId?: string
  ): Promise<TwitterPublishResult> {
    const { authToken, ct0 } = account.credentials
    try {
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
          'x-csrf-token': ct0!,
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

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const data = (await response.json()) as any
      if (data.errors) {
        return { success: false, error: data.errors[0]?.message || 'GraphQL error' }
      }

      const tweetResult =
        data?.data?.create_tweet?.tweet_results?.result ||
        data?.data?.create_tweet?.tweet_results?.result?.legacy

      const tweetId = tweetResult?.rest_id || tweetResult?.id_str
      const tweetUrl = tweetId
        ? `https://x.com/${account.username}/status/${tweetId}`
        : `https://x.com/${account.username}`

      return {
        success: true,
        tweetId,
        url: tweetUrl
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'API request failed' }
    }
  }

  /**
   * Headless Fallback: Posts tweet using a background invisible Electron browser window
   * Intercepts exact tweetId through fetch interception, DOM toast, CDP debugger, and timeline
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

      const finishSuccess = async (id?: string) => {
        if (resolved) return
        resolved = true

        let finalId = id || detectedTweetId

        // If tweetId wasn't captured directly from fetch/DOM, poll user timeline
        if (!finalId) {
          finalId = await this.fetchLatestTweetId(account)
        }

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

      // 2. WebRequest network listener as secondary trigger
      const filter = {
        urls: [
          '*://*.x.com/i/api/graphql/*/CreateTweet*',
          '*://*.twitter.com/i/api/graphql/*/CreateTweet*'
        ]
      }

      win.webContents.session.webRequest.onCompleted(filter, async (details) => {
        if ((details.statusCode === 200 || details.statusCode === 201) && !resolved) {
          // Allow DOM to update toast or CDP to parse body
          setTimeout(() => finishSuccess(), 800)
        }
      })

      // 3. Inject fetch monkey-patch before page scripts run
      win.webContents.on('did-start-navigation', () => {
        try {
          win.webContents.executeJavaScript(`
            if (!window.__ROSETTA_HOOKED__) {
              window.__ROSETTA_HOOKED__ = true;
              const origFetch = window.fetch;
              window.fetch = async (...args) => {
                const res = await origFetch(...args);
                try {
                  const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                  if (url.includes('CreateTweet')) {
                    const clone = res.clone();
                    clone.json().then(data => {
                      const tid = data?.data?.create_tweet?.tweet_results?.result?.rest_id ||
                                  data?.data?.create_tweet?.tweet_results?.result?.legacy?.id_str;
                      if (tid) window.__LAST_CREATED_TWEET_ID__ = tid;
                    }).catch(() => {});
                  }
                } catch (e) {}
                return res;
              };
            }
          `).catch(() => {})
        } catch (e) {}
      })

      // 4. Fill text and click Tweet button
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
                if (window.__LAST_CREATED_TWEET_ID__) {
                  return { tweetId: window.__LAST_CREATED_TWEET_ID__ };
                }
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
