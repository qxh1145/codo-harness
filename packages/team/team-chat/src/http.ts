/** The /team HTTP surface: page assets, JSON API and the live event stream. */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { MIN_PASSWORD_LENGTH, Throttle, hashPassword, newToken, tokenDigest, verifyPassword, digestsMatch } from './auth.ts'
import { publicMember, type TeamStore } from './store.ts'
import type { StoredAccount, TeamEvent, TeamMessage, TeamRole } from './types.ts'

const COOKIE = 'codo_team'
const MAX_BODY_BYTES = 64 * 1024
const MAX_MESSAGE_CHARS = 8000
const HEARTBEAT_MILLISECONDS = 25_000
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/u
const CHANNEL_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/u
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const
const ASSETS: Readonly<Record<string, { readonly file: string; readonly type: string }>> = {
  '/team': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/team/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/team/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/team/logo.svg': { file: 'logo.svg', type: 'image/svg+xml' },
}

/** A refused request with the status and message the page shows. */
class HttpFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Everything the routes need from the plugin. */
export interface TeamHttpOptions {
  readonly store: TeamStore
  /** Absolute directory holding the page assets. */
  readonly assets: string
  /** Current first-run setup code, undefined once an admin exists. */
  readonly setupCode: () => string | undefined
  /** Called after the first admin exists. */
  readonly onSetupComplete: () => void
  /** Whether the listener itself serves TLS. */
  readonly tls: () => boolean
  /** Validate a channel's repository, returning the relative path to store. */
  readonly resolveRepo: (repo: string) => Promise<string>
  /** Called for every stored member message. */
  readonly onMessage: (message: TeamMessage, author: StoredAccount) => void
}

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  if (typeof value !== 'string') throw new HttpFailure(400, `${name} is required.`)
  return value.trim()
}

function optionalField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name]
  return typeof value === 'string' ? value.trim() : undefined
}

function validPassword(body: Record<string, unknown>): string {
  const password = body['password']
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new HttpFailure(400, `Passwords need at least ${String(MIN_PASSWORD_LENGTH)} characters.`)
  }
  return password
}

function validUsername(body: Record<string, unknown>): string {
  const username = field(body, 'username').toLowerCase()
  if (!USERNAME.test(username)) throw new HttpFailure(400, 'Usernames use 2–32 letters, numbers, dots, dashes or underscores.')
  return username
}

function validDisplayName(body: Record<string, unknown>): string {
  const displayName = field(body, 'displayName')
  if (displayName === '' || displayName.length > 60) throw new HttpFailure(400, 'Names use 1–60 characters.')
  return displayName
}

function validRole(body: Record<string, unknown>): TeamRole {
  return body['role'] === 'admin' ? 'admin' : 'member'
}

function cookieToken(request: IncomingMessage): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at !== -1 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim()
  }
  return undefined
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const type = request.headers['content-type'] ?? ''
  if (!type.startsWith('application/json')) throw new HttpFailure(415, 'Send JSON.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new HttpFailure(413, 'That is too large.')
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Reported below as the same refusal as a non-object body.
  }
  throw new HttpFailure(400, 'Send a JSON object.')
}

function sendJson(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers,
  })
  response.end(JSON.stringify(value))
}

/** Serves one deployment's team chat and fans events out to signed-in browsers. */
export class TeamHttp {
  private readonly streams = new Map<ServerResponse, string>()
  private readonly throttle = new Throttle()
  private readonly heartbeat: NodeJS.Timeout

  constructor(private readonly options: TeamHttpOptions) {
    this.heartbeat = setInterval(() => {
      for (const stream of this.streams.keys()) stream.write(': keep-alive\n\n')
    }, HEARTBEAT_MILLISECONDS)
    this.heartbeat.unref()
  }

  /** Close every live stream. */
  dispose(): void {
    clearInterval(this.heartbeat)
    for (const stream of this.streams.keys()) stream.end()
    this.streams.clear()
  }

  /** Deliver one event to every signed-in browser. */
  publish(event: TeamEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const stream of this.streams.keys()) stream.write(frame)
  }

  /** Route handler for everything under /team. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.dispatch(request, response)
    } catch (error: unknown) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      if (error instanceof HttpFailure) {
        sendJson(response, error.status, { error: error.message })
        return
      }
      throw error
    }
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://team.invalid')
    const path = url.pathname.replace(/\/+$/u, '') || '/'
    const method = request.method ?? 'GET'
    const asset = ASSETS[path]
    if (asset !== undefined && (method === 'GET' || method === 'HEAD')) {
      await this.serveAsset(response, asset.file, asset.type, method === 'HEAD')
      return
    }
    if (!path.startsWith('/team/api/')) throw new HttpFailure(404, 'Not found.')
    if (method !== 'GET') this.assertSameOrigin(request)
    const route = path.slice('/team/api/'.length).split('/')
    await this.api(request, response, method, route, url)
  }

  private async serveAsset(response: ServerResponse, file: string, type: string, headOnly: boolean): Promise<void> {
    const body = await readFile(`${this.options.assets}/${file}`)
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': body.byteLength })
    response.end(headOnly ? undefined : body)
  }

  /** Refuse cross-site writes. The session cookie is SameSite=Strict, so this is a second layer. */
  private assertSameOrigin(request: IncomingMessage): void {
    const origin = request.headers.origin
    // A cross-site page cannot set this header without a CORS grant, and this route gives none.
    const forwarded = request.headers['x-forwarded-host']
    const host = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : request.headers.host
    if (origin === undefined || host === undefined) throw new HttpFailure(403, 'Refused.')
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      throw new HttpFailure(403, 'Refused.')
    }
    if (originHost !== host) throw new HttpFailure(403, 'Refused.')
  }

  private currentAccount(request: IncomingMessage): StoredAccount | undefined {
    const token = cookieToken(request)
    if (token === undefined) return undefined
    const session = this.options.store.sessionByHash(tokenDigest(token))
    return session === undefined ? undefined : this.options.store.accountById(session.memberId)
  }

  private requireAccount(request: IncomingMessage): StoredAccount {
    const account = this.currentAccount(request)
    if (account === undefined) throw new HttpFailure(401, 'Please sign in.')
    return account
  }

  private requireAdmin(request: IncomingMessage): StoredAccount {
    const account = this.requireAccount(request)
    if (account.role !== 'admin') throw new HttpFailure(403, 'Only admins can do this.')
    return account
  }

  private async signIn(request: IncomingMessage, response: ServerResponse, account: StoredAccount): Promise<void> {
    const token = newToken()
    await this.options.store.createSession(tokenDigest(token), account.id)
    const secure = this.options.tls() || request.headers['x-forwarded-proto'] === 'https'
    const cookie = `${COOKIE}=${token}; Path=/team; HttpOnly; SameSite=Strict; Max-Age=1209600${secure ? '; Secure' : ''}`
    sendJson(response, 200, { user: publicMember(account) }, { 'Set-Cookie': cookie })
  }

  private async api(
    request: IncomingMessage, response: ServerResponse, method: string, route: string[], url: URL,
  ): Promise<void> {
    const { store } = this.options
    const [head, id, tail] = route
    if (method === 'GET' && head === 'state') {
      const account = this.currentAccount(request)
      sendJson(response, 200, {
        setupRequired: !store.hasAccounts(),
        user: account === undefined ? null : publicMember(account),
      })
      return
    }
    if (method === 'POST' && head === 'setup') {
      await this.setup(request, response)
      return
    }
    if (method === 'POST' && head === 'login') {
      await this.login(request, response)
      return
    }
    if (method === 'POST' && head === 'logout') {
      const token = cookieToken(request)
      if (token !== undefined) await store.deleteSession(tokenDigest(token))
      sendJson(response, 200, {}, { 'Set-Cookie': `${COOKIE}=; Path=/team; HttpOnly; SameSite=Strict; Max-Age=0` })
      return
    }
    if (method === 'POST' && head === 'invites' && id === 'accept') {
      await this.acceptInvite(request, response)
      return
    }
    if (method === 'GET' && head === 'invites' && id !== undefined) {
      const invite = store.inviteByHash(tokenDigest(id))
      if (invite === undefined) throw new HttpFailure(404, 'This invitation is no longer valid.')
      sendJson(response, 200, { displayName: invite.displayName })
      return
    }

    const account = this.requireAccount(request)
    if (method === 'GET' && head === 'events') {
      this.openStream(request, response, account)
      return
    }
    if (method === 'GET' && head === 'members') {
      sendJson(response, 200, { members: store.listMembers() })
      return
    }
    if (method === 'DELETE' && head === 'members' && id !== undefined) {
      this.requireAdmin(request)
      if (id === account.id) throw new HttpFailure(400, 'You cannot remove your own account.')
      await store.removeAccount(id)
      this.closeStreamsOf(id)
      this.publish({ type: 'members-changed' })
      sendJson(response, 200, {})
      return
    }
    if (method === 'POST' && head === 'invites') {
      this.requireAdmin(request)
      const body = await readBody(request)
      const token = newToken()
      await store.createInvite({
        tokenHash: tokenDigest(token), displayName: validDisplayName(body), role: validRole(body), createdBy: account.id,
      })
      sendJson(response, 200, { token })
      return
    }
    if (method === 'GET' && head === 'channels' && id === undefined) {
      sendJson(response, 200, { channels: store.listChannels() })
      return
    }
    if (method === 'POST' && head === 'channels' && id === undefined) {
      await this.createChannel(request, response, account)
      return
    }
    if (head === 'channels' && id !== undefined) {
      if (store.channelById(id) === undefined) throw new HttpFailure(404, 'That channel does not exist.')
      if (method === 'PATCH' && tail === undefined) {
        await this.updateChannel(request, response, id)
        return
      }
      if (method === 'GET' && tail === 'messages') {
        this.listMessages(response, id, url)
        return
      }
      if (method === 'POST' && tail === 'messages') {
        await this.postMessage(request, response, id, account)
        return
      }
    }
    throw new HttpFailure(404, 'Not found.')
  }

  private async setup(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { store } = this.options
    const code = this.options.setupCode()
    if (code === undefined || store.hasAccounts()) throw new HttpFailure(409, 'This team is already set up.')
    if (!this.throttle.allows('setup')) throw new HttpFailure(429, 'Too many attempts. Wait a few minutes.')
    const body = await readBody(request)
    if (!digestsMatch(tokenDigest(field(body, 'code')), tokenDigest(code))) {
      this.throttle.fail('setup')
      throw new HttpFailure(403, 'That setup code is not correct.')
    }
    const account = await store.createAccount({
      username: validUsername(body), displayName: validDisplayName(body), role: 'admin',
      passwordHash: await hashPassword(validPassword(body)),
    })
    if (account === undefined) throw new HttpFailure(409, 'That username is taken.')
    this.options.onSetupComplete()
    await this.signIn(request, response, account)
  }

  private async login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request)
    const username = field(body, 'username').toLowerCase()
    const key = `login:${username}`
    if (!this.throttle.allows(key)) throw new HttpFailure(429, 'Too many attempts. Wait a few minutes.')
    const account = this.options.store.accountByUsername(username)
    const password = body['password']
    const matches = account !== undefined && typeof password === 'string' && password.length <= 200
      && await verifyPassword(password, account.passwordHash)
    if (!matches) {
      this.throttle.fail(key)
      throw new HttpFailure(401, 'That username or password is not correct.')
    }
    this.throttle.clear(key)
    await this.signIn(request, response, account)
  }

  private async acceptInvite(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { store } = this.options
    const body = await readBody(request)
    const tokenHash = tokenDigest(field(body, 'token'))
    const invite = store.inviteByHash(tokenHash)
    if (invite === undefined) throw new HttpFailure(404, 'This invitation is no longer valid.')
    const account = await store.createAccount({
      username: validUsername(body), displayName: invite.displayName, role: invite.role,
      passwordHash: await hashPassword(validPassword(body)),
    })
    if (account === undefined) throw new HttpFailure(409, 'That username is taken.')
    await store.deleteInvite(tokenHash)
    this.publish({ type: 'members-changed' })
    await this.signIn(request, response, account)
  }

  private async createChannel(request: IncomingMessage, response: ServerResponse, account: StoredAccount): Promise<void> {
    this.requireAdmin(request)
    const body = await readBody(request)
    const name = field(body, 'name').toLowerCase()
    if (!CHANNEL_NAME.test(name)) throw new HttpFailure(400, 'Channel names use lowercase letters, numbers and dashes.')
    const repo = optionalField(body, 'repo')
    const channel = await this.options.store.createChannel({
      name, topic: optionalField(body, 'topic')?.slice(0, 200) ?? '', createdBy: account.id,
      repo: repo === undefined || repo === '' ? null : await this.checkedRepo(repo),
    })
    if (channel === undefined) throw new HttpFailure(409, 'That channel name is taken.')
    this.publish({ type: 'channel', channel })
    sendJson(response, 200, { channel })
  }

  private async updateChannel(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
    this.requireAdmin(request)
    const body = await readBody(request)
    const repo = optionalField(body, 'repo')
    const topic = optionalField(body, 'topic')
    const channel = await this.options.store.updateChannel(id, {
      ...topic === undefined ? {} : { topic: topic.slice(0, 200) },
      ...repo === undefined ? {} : { repo: repo === '' ? null : await this.checkedRepo(repo) },
    })
    if (channel === undefined) throw new HttpFailure(404, 'That channel does not exist.')
    this.publish({ type: 'channel', channel })
    sendJson(response, 200, { channel })
  }

  private async checkedRepo(repo: string): Promise<string> {
    try {
      return await this.options.resolveRepo(repo)
    } catch (error: unknown) {
      throw new HttpFailure(400, error instanceof Error ? error.message : 'That repository is not available.')
    }
  }

  private listMessages(response: ServerResponse, channelId: string, url: URL): void {
    const { store } = this.options
    const thread = url.searchParams.get('thread')
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500)
    sendJson(response, 200, {
      messages: store.listMessages(channelId, thread, limit),
      replyCounts: thread === null ? store.replyCounts(channelId) : {},
    })
  }

  private async postMessage(
    request: IncomingMessage, response: ServerResponse, channelId: string, account: StoredAccount,
  ): Promise<void> {
    const { store } = this.options
    const body = await readBody(request)
    const text = field(body, 'text')
    if (text === '' || text.length > MAX_MESSAGE_CHARS) {
      throw new HttpFailure(400, `Messages use 1–${String(MAX_MESSAGE_CHARS)} characters.`)
    }
    const threadId = optionalField(body, 'threadId') ?? null
    if (threadId !== null) {
      const root = store.messageById(channelId, threadId)
      if (root === undefined || root.threadId !== null) throw new HttpFailure(400, 'That thread does not exist.')
    }
    const message: TeamMessage = {
      id: randomUUID(), channelId, threadId, authorId: account.id, authorKind: 'member',
      authorName: account.displayName, text, createdAt: Date.now(),
    }
    await store.putMessage(message)
    this.publish({ type: 'message', message })
    sendJson(response, 200, { message })
    this.options.onMessage(message, account)
  }

  private openStream(request: IncomingMessage, response: ServerResponse, account: StoredAccount): void {
    response.writeHead(200, {
      ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
    })
    response.write(': connected\n\n')
    this.streams.set(response, account.id)
    request.once('close', () => { this.streams.delete(response) })
  }

  private closeStreamsOf(memberId: string): void {
    for (const [stream, owner] of this.streams) {
      if (owner !== memberId) continue
      stream.end()
      this.streams.delete(stream)
    }
  }
}
