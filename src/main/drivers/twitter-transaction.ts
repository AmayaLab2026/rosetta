/**
 * Pure TypeScript implementation of X (Twitter) client transaction ID generator.
 * Eliminates external DOM dependencies (linkedom, css-select, etc.) to guarantee 100% CJS/ESM compatibility.
 */

class Cubic {
  static EPSILON = 0.0000001
  static NEWTON_ITERATIONS = 4
  static SPLINE_SAMPLES = 11
  static SPLINE_STEP = 1 / (Cubic.SPLINE_SAMPLES - 1)

  private ax: number
  private bx: number
  private cx: number
  private ay: number
  private by: number
  private cy: number
  private startGradient: number
  private endGradient: number
  private splineSamples: number[]

  constructor(curves: number[]) {
    const [x1, y1, x2, y2] = curves
    this.cx = 3 * x1
    this.bx = 3 * (x2 - x1) - this.cx
    this.ax = 1 - this.cx - this.bx
    this.cy = 3 * y1
    this.by = 3 * (y2 - y1) - this.cy
    this.ay = 1 - this.cy - this.by

    if (x1 > 0) {
      this.startGradient = y1 / x1
    } else if (y1 === 0 && x2 > 0) {
      this.startGradient = y2 / x2
    } else if (y1 === 0 && y2 === 0) {
      this.startGradient = 1
    } else {
      this.startGradient = 0
    }

    if (x2 < 1) {
      this.endGradient = (y2 - 1) / (x2 - 1)
    } else if (y2 === 1 && x1 < 1) {
      this.endGradient = (y1 - 1) / (x1 - 1)
    } else if (y2 === 1 && y1 === 1) {
      this.endGradient = 1
    } else {
      this.endGradient = 0
    }

    this.splineSamples = Array.from({ length: Cubic.SPLINE_SAMPLES }, (_, i) =>
      this.sampleX(i * Cubic.SPLINE_STEP)
    )
  }

  getValue(time: number): number {
    if (time < 0) return this.startGradient * time
    if (time > 1) return 1 + this.endGradient * (time - 1)
    return this.sampleY(this.solveCurveX(time))
  }

  private sampleX(t: number): number {
    return ((this.ax * t + this.bx) * t + this.cx) * t
  }

  private sampleY(t: number): number {
    return ((this.ay * t + this.by) * t + this.cy) * t
  }

  private sampleDerivativeX(t: number): number {
    return (3 * this.ax * t + 2 * this.bx) * t + this.cx
  }

  private solveCurveX(x: number): number {
    let t0 = 0
    let t1 = 1
    let t2 = x
    for (let i = 1; i < Cubic.SPLINE_SAMPLES; i++) {
      if (x <= this.splineSamples[i]) {
        t1 = Cubic.SPLINE_STEP * i
        t0 = t1 - Cubic.SPLINE_STEP
        t2 = t0 + ((t1 - t0) * (x - this.splineSamples[i - 1])) / (this.splineSamples[i] - this.splineSamples[i - 1])
        break
      }
    }
    let x2 = 0
    for (let i = 0; i < Cubic.NEWTON_ITERATIONS; i++) {
      x2 = this.sampleX(t2) - x
      if (Math.abs(x2) < Cubic.EPSILON) return t2
      const d2 = this.sampleDerivativeX(t2)
      if (Math.abs(d2) < Cubic.EPSILON) break
      t2 -= x2 / d2
    }
    if (Math.abs(x2) < Cubic.EPSILON) return t2
    while (t0 < t1) {
      x2 = this.sampleX(t2)
      if (Math.abs(x2 - x) < Cubic.EPSILON) return t2
      if (x > x2) t0 = t2
      else t1 = t2
      t2 = (t1 + t0) * 0.5
    }
    return t2
  }
}

function interpolate(fromList: number[], toList: number[], f: number): number[] {
  return fromList.map((from, i) => interpolateNum(from, toList[i], f))
}

function interpolateNum(fromVal: number, toVal: number, f: number): number {
  return fromVal * (1 - f) + toVal * f
}

function convertRotationToMatrix(rotation: number): number[] {
  const rad = (rotation * Math.PI) / 180
  return [Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad)]
}

function floatToHex(x: number): string {
  const integer = Math.floor(x)
  let fraction = x - integer
  let result = integer > 0 ? integer.toString(16).toUpperCase() : ''
  if (fraction === 0) return result
  result += '.'
  while (fraction > 0) {
    fraction *= 16
    const digit = Math.floor(fraction)
    fraction -= digit
    result += digit.toString(16).toUpperCase()
  }
  return result
}

function isOdd(num: number): number {
  return num % 2 ? -1 : 0
}

function solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
  const result = ((value * (maxVal - minVal)) / 255) + minVal
  return rounding ? Math.floor(result) : Math.round(result * 100) / 100
}

function formatMatrixValue(value: number): string {
  if (value === 0) return '0'
  const sign = value < 0 ? '-' : ''
  const [mantissa, exponentText] = Math.abs(value).toExponential(5).split('e')
  const exponent = parseInt(exponentText, 10)
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0'
  if (exponent < -4 || exponent >= 6) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
    const expSign = exponent < 0 ? '-' : '+'
    const expDigits = String(Math.abs(exponent)).padStart(2, '0')
    return `${sign}${head}e${expSign}${expDigits}`
  }
  if (exponent >= 0) {
    const intPart = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0')
    const fracPart = digits.slice(exponent + 1)
    return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`
  }
  return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`
}

function matrixNumbers(value: number): number[] {
  return (formatMatrixValue(value).match(/[\d.-]+/g) ?? []).map(Number)
}

function animate(frameRow: number[], targetTime: number): string {
  const fromColor = frameRow.slice(0, 3)
  const toColor = frameRow.slice(3, 6)
  const toRotation = solve(frameRow[6], 60, 360, true)
  const curves = frameRow.slice(7).map((value, index) => solve(value, isOdd(index), 1, false))
  const progress = new Cubic(curves).getValue(targetTime)
  const color = interpolate(fromColor, toColor, progress).map((channel) =>
    Math.round(Math.max(0, Math.min(255, channel))).toString(16)
  )
  const rotation = interpolateNum(0, toRotation, progress)
  const matrix = convertRotationToMatrix(rotation)
    .flatMap((value) => matrixNumbers(value))
    .map((num) => {
      const hex = floatToHex(Math.abs(Number(num.toFixed(2)))).toLowerCase()
      return hex.startsWith('.') ? `0${hex}` : hex || '0'
    })
  return [...color, ...matrix, '0', '0'].join('').replace(/[.-]/g, '')
}

function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function encodeBase64(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
}

const TOTAL_TIME = 4096
const KEYWORD = 'obfiowerehiring'
const ADDITIONAL_RANDOM_NUMBER = 3
const EPOCH_SECONDS = 1682924400

interface CachedKeys {
  keyBytes: number[]
  animationKey: string
  timestamp: number
}

let cachedSession: CachedKeys | null = null

export async function generateTwitterTransactionId(method: string, path: string): Promise<string> {
  const now = Date.now()
  // Cache key data for 10 minutes
  if (!cachedSession || now - cachedSession.timestamp > 10 * 60 * 1000) {
    try {
      const res = await fetch('https://x.com/i/jf/', {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          'accept-language': 'ja'
        }
      })
      if (!res.ok) {
        throw new Error(`Failed to fetch X homepage: ${res.status}`)
      }
      const html = await res.text()

      // 1. Verification key
      const metaMatch =
        html.match(/name=['"]twitter-site-verification['"]\s+content=['"]([^'"]+)['"]/i) ||
        html.match(/content=['"]([^'"]+)['"]\s+name=['"]twitter-site-verification['"]/i)
      if (!metaMatch) throw new Error('twitter-site-verification meta tag not found')
      const keyBytes = Array.from(decodeBase64(metaMatch[1]))

      // 2. Ondemand hash
      const hashRegex =
        /(\d+):\s*["']ondemand\.s["'][\s\S]*?\}\)\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.["']\s*\+\s*\(\{[\s\S]*?\b\1:\s*["']([a-zA-Z0-9_-]+)["']/
      const hashMatch = hashRegex.exec(html)
      if (!hashMatch) throw new Error('ondemand.s hash not found in script bundle')
      const chunkUrl = `https://abs.twimg.com/responsive-web/client-web/ondemand.s.${hashMatch[2]}a.js`

      const chunkRes = await fetch(chunkUrl)
      if (!chunkRes.ok) throw new Error(`Failed to fetch ondemand chunk: ${chunkRes.status}`)
      const chunkJs = await chunkRes.text()

      const indices = Array.from(chunkJs.matchAll(/\(\w\[(\d{1,2})\],\s*16\)/g), (m) => Number(m[1]))
      if (indices.length < 2) throw new Error('Failed to extract animation indices')
      const [rowIndex, ...keyBytesIndices] = indices

      // 3. SVG frame animations
      const anims = [...html.matchAll(/id=['"]loading-x-anim-0?(\d+)['"][\s\S]*?<\/svg>/g)]
      const targetAnimIndex = keyBytes[5] % 4
      const targetAnim = anims[targetAnimIndex]?.[0]
      if (!targetAnim) throw new Error('Animation SVG target not found')
      const paths = [...targetAnim.matchAll(/<path[^>]+d=['"]([^'"]+)['"]/g)]
      const pathD = paths[1]?.[1] || paths[0]?.[1]
      if (!pathD) throw new Error('Animation path d attribute not found')

      const frameRows = pathD
        .substring(9)
        .split('C')
        .map((segment) => (segment.match(/\d+/g) ?? []).map(Number))

      const targetRowIndex = keyBytes[rowIndex] % 16
      const frameRow = frameRows[targetRowIndex]
      if (!frameRow) throw new Error(`Frame row ${targetRowIndex} not found`)

      const frameTime = keyBytesIndices.reduce((t, idx) => t * (keyBytes[idx] % 16), 1)
      const animationKey = animate(frameRow, (Math.round(frameTime / 10) * 10) / TOTAL_TIME)

      cachedSession = {
        keyBytes,
        animationKey,
        timestamp: now
      }
    } catch (err) {
      console.warn('[TwitterTransaction] Key calculation failed:', err)
      cachedSession = null
      return ''
    }
  }

  try {
    const { keyBytes, animationKey } = cachedSession
    const time = Math.floor((Date.now() - EPOCH_SECONDS * 1000) / 1000)
    const data = `${method}!${path}!${time}${KEYWORD}${animationKey}`
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))
    const randomByte = Math.floor(Math.random() * 256)
    const bytes = [
      ...keyBytes,
      ...[0, 8, 16, 24].map((shift) => (time >> shift) & 255),
      ...hash.slice(0, 16),
      ADDITIONAL_RANDOM_NUMBER
    ]
    const out = Uint8Array.from([randomByte, ...bytes.map((byte) => byte ^ randomByte)])
    return encodeBase64(out).replace(/=/g, '')
  } catch (err) {
    console.warn('[TwitterTransaction] Generate transaction ID failed:', err)
    return ''
  }
}

/**
 * Pre-warm the Twitter transaction key in the background to ensure instant zero-latency signing
 */
export async function prewarmTwitterTransaction(): Promise<boolean> {
  const now = Date.now()
  if (cachedSession && now - cachedSession.timestamp < 8 * 60 * 1000) {
    return true
  }
  try {
    const tid = await generateTwitterTransactionId('POST', '/i/api/graphql/UecQIuYzi2MCOah7-eOpcQ/CreateTweet')
    if (tid) {
      console.log('[TwitterTransaction] Key successfully pre-warmed for instant signing.')
      return true
    }
  } catch (err) {
    console.warn('[TwitterTransaction] Pre-warm failed:', err)
  }
  return false
}
