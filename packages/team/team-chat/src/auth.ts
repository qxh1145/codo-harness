/** Password hashing, opaque tokens and sign-in throttling. */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_BYTES = 32
const SALT_BYTES = 16
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024
const MAX_FAILURES = 5
const LOCK_MILLISECONDS = 5 * 60 * 1000

/** Shortest password an account may use. */
export const MIN_PASSWORD_LENGTH = 10

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { N, r, p, maxmem: SCRYPT_MAX_MEMORY }, (error, key) => {
      if (error === null) resolve(key)
      else reject(error)
    })
  })
}

/**
 * Hash a password for storage.
 * @param password - the plain password.
 * @returns a self-describing scrypt record.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
  return `scrypt$${String(SCRYPT_N)}$${String(SCRYPT_R)}$${String(SCRYPT_P)}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/**
 * Check a password against a stored record in constant time.
 * @param password - the submitted password.
 * @param stored - a record from {@link hashPassword}.
 * @returns whether the password matches.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || N === undefined || r === undefined || p === undefined
    || salt === undefined || key === undefined) return false
  const expected = Buffer.from(key, 'base64url')
  const actual = await derive(password, Buffer.from(salt, 'base64url'), Number(N), Number(r), Number(p))
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

/** @returns a new unguessable URL-safe token. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Digest a token for storage, so a leaked data file exposes no live credential.
 * @param token - the plain token.
 * @returns its hex SHA-256 digest.
 */
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Compare two digests in constant time. */
export function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

/** Locks a key after repeated failures. Entries live in memory, so a restart clears them. */
export class Throttle {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  /** @returns whether this key may try now. */
  allows(key: string): boolean {
    const entry = this.failures.get(key)
    if (entry === undefined) return true
    if (entry.lockedUntil > this.now()) return false
    if (entry.lockedUntil !== 0) this.failures.delete(key)
    return true
  }

  /** Count one failed attempt. */
  fail(key: string): void {
    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 }
    entry.count += 1
    if (entry.count >= MAX_FAILURES) entry.lockedUntil = this.now() + LOCK_MILLISECONDS
    this.failures.set(key, entry)
  }

  /** Forget a key after a successful attempt. */
  clear(key: string): void {
    this.failures.delete(key)
  }
}
