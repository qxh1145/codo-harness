import { describe, expect, it } from 'vitest'
import { Throttle, hashPassword, newToken, tokenDigest, verifyPassword } from '../src/auth.ts'

describe('passwords', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(stored).not.toContain('correct')
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true)
    await expect(verifyPassword('wrong horse battery', stored)).resolves.toBe(false)
  })

  it('salts each hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'))
  })

  it('refuses a malformed record', async () => {
    await expect(verifyPassword('anything', 'not-a-record')).resolves.toBe(false)
  })
})

describe('tokens', () => {
  it('are unique and stored only as digests', () => {
    const token = newToken()
    expect(newToken()).not.toBe(token)
    expect(tokenDigest(token)).not.toContain(token)
  })
})

describe('Throttle', () => {
  it('locks after five failures and unlocks after the wait', () => {
    let now = 0
    const throttle = new Throttle(() => now)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(throttle.allows('key')).toBe(true)
      throttle.fail('key')
    }
    expect(throttle.allows('key')).toBe(false)
    now += 5 * 60 * 1000 + 1
    expect(throttle.allows('key')).toBe(true)
  })

  it('forgets a key after success', () => {
    const throttle = new Throttle(() => 0)
    for (let attempt = 0; attempt < 4; attempt += 1) throttle.fail('key')
    throttle.clear('key')
    throttle.fail('key')
    expect(throttle.allows('key')).toBe(true)
  })
})
