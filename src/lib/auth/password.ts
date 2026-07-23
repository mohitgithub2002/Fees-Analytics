import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with scrypt (built into Node — no native dependency).
 * Stored format: "scrypt$<saltHex>$<hashHex>". Node-only; used by the login,
 * setup, and create-admin flows, never from the proxy.
 */

const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split('$')
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
