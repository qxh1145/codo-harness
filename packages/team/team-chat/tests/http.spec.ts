import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TeamHttp } from '../src/http.ts'
import { TeamStore } from '../src/store.ts'

const data = mkdtempSync(join(tmpdir(), 'team-chat-http-'))
const onMessage = vi.fn()
let server: Server
let origin: string
let http: TeamHttp
let setupCode: string | undefined = 'setup-code'

/** One browser: keeps its own cookie. */
class Browser {
  cookie = ''

  async call(
    method: string, path: string, body?: unknown, headers: Record<string, string> = {},
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await fetch(`${origin}/team/api/${path}`, {
      method,
      headers: {
        ...method === 'GET' ? {} : { Origin: origin },
        ...body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...this.cookie === '' ? {} : { Cookie: this.cookie },
        ...headers,
      },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie !== null) this.cookie = setCookie.split(';')[0] ?? ''
    return { status: response.status, data: await response.json() as Record<string, unknown> }
  }
}

const admin = new Browser()
const member = new Browser()
const stranger = new Browser()

beforeAll(async () => {
  const store = await TeamStore.open(data)
  http = new TeamHttp({
    store,
    assets: fileURLToPath(new URL('../assets', import.meta.url)),
    setupCode: () => setupCode,
    onSetupComplete: () => { setupCode = undefined },
    tls: () => false,
    resolveRepo: repo => repo === 'app' ? Promise.resolve('app') : Promise.reject(new Error('No repository called that.')),
    onMessage,
  })
  server = createServer((request, response) => { void http.handle(request, response) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(async () => {
  http.dispose()
  server.closeAllConnections()
  await new Promise((resolve) => { server.close(resolve) })
  rmSync(data, { recursive: true, force: true })
})

describe('team chat HTTP', () => {
  it('serves the page with a strict content security policy', async () => {
    const response = await fetch(`${origin}/team`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'")
  })

  it('requires the setup code for the first admin', async () => {
    const wrong = await stranger.call('POST', 'setup', { code: 'nope', username: 'an', displayName: 'An', password: 'long enough password' })
    expect(wrong.status).toBe(403)
    const created = await admin.call('POST', 'setup', { code: 'setup-code', username: 'An', displayName: 'An', password: 'long enough password' })
    expect(created.status).toBe(200)
    expect(admin.cookie).toMatch(/^codo_team=/u)
    expect(await stranger.call('POST', 'setup', { code: 'setup-code', username: 'b1', displayName: 'B', password: 'long enough password' }))
      .toMatchObject({ status: 409 })
  })

  it('never returns password hashes', async () => {
    const { data: body } = await admin.call('GET', 'members')
    expect(JSON.stringify(body)).not.toContain('scrypt')
  })

  it('adds members only through a single-use invitation', async () => {
    const invite = await admin.call('POST', 'invites', { displayName: 'Binh' })
    const token = invite.data['token'] as string
    expect((await member.call('GET', `invites/${token}`)).data).toEqual({ displayName: 'Binh' })
    const joined = await member.call('POST', 'invites/accept', { token, username: 'binh', password: 'another long password' })
    expect(joined.status).toBe(200)
    expect(joined.data).toMatchObject({ user: { username: 'binh', role: 'member' } })
    expect((await stranger.call('POST', 'invites/accept', { token, username: 'cuong', password: 'another long password' })).status).toBe(404)
  })

  it('keeps admin actions away from members and strangers', async () => {
    expect((await member.call('POST', 'channels', { name: 'nope' })).status).toBe(403)
    expect((await member.call('POST', 'invites', { displayName: 'X' })).status).toBe(403)
    expect((await stranger.call('GET', 'channels')).status).toBe(401)
    expect((await stranger.call('GET', 'events')).status).toBe(401)
  })

  it('refuses a write from another origin', async () => {
    const response = await admin.call('POST', 'channels', { name: 'evil' }, { Origin: 'https://evil.example' })
    expect(response.status).toBe(403)
  })

  it('accepts the public host a reverse proxy reports', async () => {
    const response = await admin.call('POST', 'channels', { name: 'proxied' }, {
      Origin: 'https://office-mac.example.ts.net', 'X-Forwarded-Host': 'office-mac.example.ts.net',
    })
    expect(response.status).toBe(200)
  })

  it('refuses a repository the deployment cannot resolve', async () => {
    const response = await admin.call('POST', 'channels', { name: 'bad', repo: '../../etc' })
    expect(response).toMatchObject({ status: 400, data: { error: 'No repository called that.' } })
  })

  it('stores channel and thread messages and reports them', async () => {
    const created = await admin.call('POST', 'channels', { name: 'backend', repo: 'app' })
    const channelId = (created.data['channel'] as { id: string }).id
    const root = await member.call('POST', `channels/${channelId}/messages`, { text: 'hello @codo' })
    const rootId = (root.data['message'] as { id: string }).id
    expect(onMessage).toHaveBeenCalledOnce()
    await admin.call('POST', `channels/${channelId}/messages`, { text: 'a reply', threadId: rootId })
    const channel = await admin.call('GET', `channels/${channelId}/messages`)
    expect(channel.data['messages']).toHaveLength(1)
    expect(channel.data['replyCounts']).toEqual({ [rootId]: 1 })
    const thread = await admin.call('GET', `channels/${channelId}/messages?thread=${rootId}`)
    expect(thread.data['messages']).toHaveLength(2)
    expect((await member.call('POST', `channels/${channelId}/messages`, { text: 'x', threadId: 'missing' })).status).toBe(400)
    expect((await member.call('POST', `channels/${channelId}/messages`, { text: '   ' })).status).toBe(400)
  })

  it('locks sign-in after repeated failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await stranger.call('POST', 'login', { username: 'binh', password: 'wrong password' })).status).toBe(401)
    }
    expect((await stranger.call('POST', 'login', { username: 'binh', password: 'another long password' })).status).toBe(429)
  })

  it('ends a removed member’s access at once', async () => {
    const { data: body } = await admin.call('GET', 'members')
    const binh = (body['members'] as { id: string; username: string }[]).find(entry => entry.username === 'binh')
    expect((await admin.call('DELETE', `members/${binh?.id ?? ''}`)).status).toBe(200)
    expect((await member.call('GET', 'channels')).status).toBe(401)
  })

  it('reloads everything from disk', async () => {
    const reopened = await TeamStore.open(data)
    expect(reopened.listChannels()).toHaveLength(2)
    expect(reopened.hasAccounts()).toBe(true)
  })
})
