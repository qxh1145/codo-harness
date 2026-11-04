/** Durable and wire records of team chat. */

/** What one account may do. Admins manage members and channels. */
export type TeamRole = 'admin' | 'member'

/** One person who can sign in. */
export interface TeamMember {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly role: TeamRole
  readonly createdAt: number
}

/** A stored account: the public member plus its password hash. */
export interface StoredAccount extends TeamMember {
  readonly passwordHash: string
}

/** One signed-in browser. Only the token's digest is stored. */
export interface StoredSession {
  readonly tokenHash: string
  readonly memberId: string
  readonly expiresAt: number
}

/** One unused invitation. Only the token's digest is stored. */
export interface StoredInvite {
  readonly tokenHash: string
  readonly displayName: string
  readonly role: TeamRole
  readonly createdBy: string
  readonly expiresAt: number
}

/** One project channel. */
export interface TeamChannel {
  readonly id: string
  readonly name: string
  readonly topic: string
  /** Repository directory @codo may read, relative to the deployment's repository root. */
  readonly repo: string | null
  readonly createdBy: string
  readonly createdAt: number
}

/** Progress of one @codo reply. */
export type AgentReplyStatus = 'queued' | 'running' | 'done' | 'failed'

/** One message. A later record with the same id replaces an earlier one. */
export interface TeamMessage {
  readonly id: string
  readonly channelId: string
  /** Root message of the thread this message replies in; null for a channel message. */
  readonly threadId: string | null
  readonly authorId: string
  readonly authorKind: 'member' | 'agent'
  readonly authorName: string
  readonly text: string
  readonly createdAt: number
  readonly agentStatus?: AgentReplyStatus
}

/** One live update delivered to signed-in browsers. */
export type TeamEvent =
  | { readonly type: 'message'; readonly message: TeamMessage }
  | { readonly type: 'message-updated'; readonly message: TeamMessage }
  | { readonly type: 'channel'; readonly channel: TeamChannel }
  | { readonly type: 'members-changed' }
