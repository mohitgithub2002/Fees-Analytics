/**
 * Stateless session tokens: a base64url JSON payload signed with HMAC-SHA256.
 *
 * Implemented entirely with Web Crypto (`crypto.subtle`) and standard globals
 * so the exact same code runs in the proxy gate and in Node route handlers —
 * no `node:crypto`, no Buffer. Tokens are self-contained (they carry `exp`),
 * so verifying one needs no database round-trip.
 */

export interface TokenPayload {
  sub: number // user id
  email: string
  name: string
  role: string
  exp: number // epoch ms
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const body = bytesToB64url(encoder.encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(body) as BufferSource),
  )
  return `${body}.${bytesToB64url(sig)}`
}

/** Verify signature and expiry; returns the payload or null. */
export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)

  let signature: Uint8Array
  try {
    signature = b64urlToBytes(sigPart)
  } catch {
    return null
  }

  const key = await hmacKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature as BufferSource,
    encoder.encode(body) as BufferSource,
  )
  if (!valid) return null

  try {
    const json = new TextDecoder().decode(b64urlToBytes(body))
    const payload = JSON.parse(json) as TokenPayload
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null
    if (typeof payload.sub !== 'number') return null
    return payload
  } catch {
    return null
  }
}
