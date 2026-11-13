const MAX_SKEW_SECONDS = 5 * 60
const encoder = new TextEncoder()

export interface SlackSignatureInput {
  signingSecret: string
  timestamp: string | null | undefined
  signature: string | null | undefined
  rawBody: string
  nowSeconds?: number
}

export type SlackSignatureVerdict =
  | { ok: true }
  | { ok: false, status: 401, reason: 'invalid_signature' | 'stale_timestamp', message: string }

export async function verifySlackSignature (input: SlackSignatureInput): Promise<SlackSignatureVerdict> {
  const secret = input.signingSecret.trim()
  if (!secret) {
    return {
      ok: false,
      status: 401,
      reason: 'invalid_signature',
      message: 'Slack signing secret is not set.'
    }
  }

  const timestamp = (input.timestamp ?? '').trim()
  const provided = (input.signature ?? '').trim()
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!/^\d{1,20}$/.test(timestamp)) {
    return {
      ok: false,
      status: 401,
      reason: 'stale_timestamp',
      message: 'Slack request timestamp is missing or stale.'
    }
  }
  const skew = Math.abs(now - Number(timestamp))
  if (skew > MAX_SKEW_SECONDS) {
    return {
      ok: false,
      status: 401,
      reason: 'stale_timestamp',
      message: 'Slack request timestamp is outside the 5 minute window.'
    }
  }

  const expected = 'v0=' + await hmacSha256Hex(secret, `v0:${timestamp}:${input.rawBody}`)
  const matches = await signaturesMatch(provided, expected)
  if (!matches) {
    return {
      ok: false,
      status: 401,
      reason: 'invalid_signature',
      message: 'Slack request signature does not match.'
    }
  }
  return { ok: true }
}

async function hmacSha256Hex (secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return toHex(new Uint8Array(signature))
}

async function signaturesMatch (provided: string, expected: string): Promise<boolean> {
  const providedBytes = encoder.encode(provided)
  const expectedBytes = encoder.encode(expected)
  if (providedBytes.byteLength !== expectedBytes.byteLength) {
    await timingSafeEqualBytes(expectedBytes, expectedBytes)
    return false
  }
  return timingSafeEqualBytes(providedBytes, expectedBytes)
}

async function timingSafeEqualBytes (left: Uint8Array, right: Uint8Array): Promise<boolean> {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean
  }
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(left, right)
  const { timingSafeEqual } = await import('node:crypto')
  return timingSafeEqual(left, right)
}

function toHex (bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
