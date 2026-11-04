/** File-backed team data: small JSON documents plus one append-only log per channel. */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  StoredAccount, StoredInvite, StoredSession, TeamChannel, TeamMember, TeamMessage, TeamRole,
} from './types.ts'

const SESSION_MILLISECONDS = 14 * 24 * 60 * 60 * 1000
const INVITE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000

/** Read one JSON document, or the fallback when the file does not exist. */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

/** Replace one JSON document atomically, readable only by this user. */
async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/** Strip the password hash from an account. */
export function publicMember(account: StoredAccount): TeamMember {
  return {
    id: account.id, username: account.username, displayName: account.displayName,
    role: account.role, createdAt: account.createdAt,
  }
}

/** Owns every team record. Writes are serialized, so concurrent requests cannot lose updates. */
export class TeamStore {
  private accounts: StoredAccount[] = []
  private sessions: StoredSession[] = []
  private invites: StoredInvite[] = []
  private channels: TeamChannel[] = []
  private readonly messages = new Map<string, Map<string, TeamMessage>>()
  private tail: Promise<unknown> = Promise.resolve()

  private constructor(private readonly root: string, private readonly now: () => number) {}

  /**
   * Open the store, creating its directory on first use.
   * @param root - directory holding team data.
   * @param now - clock.
   * @returns the loaded store.
   */
  static async open(root: string, now: () => number = Date.now): Promise<TeamStore> {
    const store = new TeamStore(root, now)
    await mkdir(join(root, 'channels'), { recursive: true, mode: 0o700 })
    store.accounts = await readJson(store.path('accounts.json'), [])
    store.sessions = await readJson(store.path('sessions.json'), [])
    store.invites = await readJson(store.path('invites.json'), [])
    store.channels = await readJson(store.path('channels.json'), [])
    for (const channel of store.channels) await store.loadMessages(channel.id)
    return store
  }

  private path(name: string): string {
    return join(this.root, name)
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work)
    this.tail = run.catch(() => undefined)
    return run
  }

  private async loadMessages(channelId: string): Promise<void> {
    const byId = new Map<string, TeamMessage>()
    let text = ''
    try {
      text = await readFile(join(this.root, 'channels', `${channelId}.jsonl`), 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const line of text.split('\n')) {
      if (line === '') continue
      const message = JSON.parse(line) as TeamMessage
      byId.set(message.id, message)
    }
    this.messages.set(channelId, byId)
  }

  /** @returns whether any account exists. */
  hasAccounts(): boolean {
    return this.accounts.length > 0
  }

  /** @returns every member, without password hashes. */
  listMembers(): TeamMember[] {
    return this.accounts.map(publicMember)
  }

  /** @returns one account by id. */
  accountById(id: string): StoredAccount | undefined {
    return this.accounts.find(account => account.id === id)
  }

  /** @returns one account by case-insensitive username. */
  accountByUsername(username: string): StoredAccount | undefined {
    const wanted = username.toLowerCase()
    return this.accounts.find(account => account.username === wanted)
  }

  /**
   * Add an account.
   * @returns the new account, or undefined when the username is taken.
   */
  createAccount(input: {
    readonly username: string
    readonly displayName: string
    readonly role: TeamRole
    readonly passwordHash: string
  }): Promise<StoredAccount | undefined> {
    return this.serialized(async () => {
      const username = input.username.toLowerCase()
      if (this.accounts.some(account => account.username === username)) return undefined
      const account: StoredAccount = {
        id: randomUUID(), username, displayName: input.displayName, role: input.role,
        passwordHash: input.passwordHash, createdAt: this.now(),
      }
      this.accounts = [...this.accounts, account]
      await writeJson(this.path('accounts.json'), this.accounts)
      return account
    })
  }

  /** Remove an account and end its sessions. */
  removeAccount(id: string): Promise<void> {
    return this.serialized(async () => {
      this.accounts = this.accounts.filter(account => account.id !== id)
      this.sessions = this.sessions.filter(session => session.memberId !== id)
      await writeJson(this.path('accounts.json'), this.accounts)
      await writeJson(this.path('sessions.json'), this.sessions)
    })
  }

  /** Record one signed-in browser. */
  createSession(tokenHash: string, memberId: string): Promise<void> {
    return this.serialized(async () => {
      const now = this.now()
      this.sessions = [
        ...this.sessions.filter(session => session.expiresAt > now),
        { tokenHash, memberId, expiresAt: now + SESSION_MILLISECONDS },
      ]
      await writeJson(this.path('sessions.json'), this.sessions)
    })
  }

  /** @returns the live session for a token digest. */
  sessionByHash(tokenHash: string): StoredSession | undefined {
    const session = this.sessions.find(candidate => candidate.tokenHash === tokenHash)
    return session !== undefined && session.expiresAt > this.now() ? session : undefined
  }

  /** End one signed-in browser. */
  deleteSession(tokenHash: string): Promise<void> {
    return this.serialized(async () => {
      this.sessions = this.sessions.filter(session => session.tokenHash !== tokenHash)
      await writeJson(this.path('sessions.json'), this.sessions)
    })
  }

  /** Record one invitation. */
  createInvite(input: Omit<StoredInvite, 'expiresAt'>): Promise<void> {
    return this.serialized(async () => {
      const now = this.now()
      this.invites = [
        ...this.invites.filter(invite => invite.expiresAt > now),
        { ...input, expiresAt: now + INVITE_MILLISECONDS },
      ]
      await writeJson(this.path('invites.json'), this.invites)
    })
  }

  /** @returns a live invitation for a token digest. */
  inviteByHash(tokenHash: string): StoredInvite | undefined {
    const invite = this.invites.find(candidate => candidate.tokenHash === tokenHash)
    return invite !== undefined && invite.expiresAt > this.now() ? invite : undefined
  }

  /** Spend one invitation. */
  deleteInvite(tokenHash: string): Promise<void> {
    return this.serialized(async () => {
      this.invites = this.invites.filter(invite => invite.tokenHash !== tokenHash)
      await writeJson(this.path('invites.json'), this.invites)
    })
  }

  /** @returns every channel. */
  listChannels(): TeamChannel[] {
    return [...this.channels]
  }

  /** @returns one channel. */
  channelById(id: string): TeamChannel | undefined {
    return this.channels.find(channel => channel.id === id)
  }

  /**
   * Add a channel.
   * @returns the channel, or undefined when the name is taken.
   */
  createChannel(input: Pick<TeamChannel, 'name' | 'topic' | 'repo' | 'createdBy'>): Promise<TeamChannel | undefined> {
    return this.serialized(async () => {
      if (this.channels.some(channel => channel.name === input.name)) return undefined
      const channel: TeamChannel = { ...input, id: randomUUID(), createdAt: this.now() }
      this.channels = [...this.channels, channel]
      this.messages.set(channel.id, new Map())
      await writeJson(this.path('channels.json'), this.channels)
      return channel
    })
  }

  /** Change a channel's topic or repository. */
  updateChannel(id: string, patch: Partial<Pick<TeamChannel, 'topic' | 'repo'>>): Promise<TeamChannel | undefined> {
    return this.serialized(async () => {
      const current = this.channels.find(channel => channel.id === id)
      if (current === undefined) return undefined
      const updated = { ...current, ...patch }
      this.channels = this.channels.map(channel => channel.id === id ? updated : channel)
      await writeJson(this.path('channels.json'), this.channels)
      return updated
    })
  }

  /** Store a new message or replace one with the same id. */
  putMessage(message: TeamMessage): Promise<void> {
    return this.serialized(async () => {
      const byId = this.messages.get(message.channelId)
      if (byId === undefined) throw new Error(`team-chat: unknown channel ${message.channelId}`)
      await appendFile(join(this.root, 'channels', `${message.channelId}.jsonl`),
        `${JSON.stringify(message)}\n`, { mode: 0o600 })
      byId.set(message.id, message)
    })
  }

  /** @returns one message. */
  messageById(channelId: string, id: string): TeamMessage | undefined {
    return this.messages.get(channelId)?.get(id)
  }

  /**
   * List messages oldest first.
   * @param channelId - channel to read.
   * @param threadId - thread root, or null for channel messages only.
   * @param limit - most recent messages to return.
   * @returns the matching messages.
   */
  listMessages(channelId: string, threadId: string | null, limit: number): TeamMessage[] {
    const all = [...this.messages.get(channelId)?.values() ?? []]
    const matching = threadId === null
      ? all.filter(message => message.threadId === null)
      : all.filter(message => message.id === threadId || message.threadId === threadId)
    return matching.slice(-limit)
  }

  /** @returns how many replies each thread root in a channel has. */
  replyCounts(channelId: string): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const message of this.messages.get(channelId)?.values() ?? []) {
      if (message.threadId !== null) counts[message.threadId] = (counts[message.threadId] ?? 0) + 1
    }
    return counts
  }
}
