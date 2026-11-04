/**
 * Team chat at /team: individual accounts, project channels and a read-only @codo agent.
 *
 * Members authenticate here and never receive the Host's owner Peer, so a member account grants
 * chat and nothing else.
 *
 * @module @deepseek-ai/dsh-team-chat
 */

import { randomBytes } from 'node:crypto'
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-title'
import z from '@deepseek-ai/schemastery'
import { CodoRunner } from './codo-runner.ts'
import { TeamHttp } from './http.ts'
import { TeamStore } from './store.ts'

export * from './types.ts'
export { mentionsCodo, buildPrompt } from './codo-runner.ts'
export { refuseOutsideRepo } from './repo-guard.ts'

export const name = 'team-chat'
export const inject = ['webServer']

/** Plugin configuration. */
export interface Config {
  /** Directory for accounts, channels and messages. Defaults to `<DSH_HOME>/team`. */
  dataDir?: string
  /** Directory holding the repositories channels may link. Defaults to `<DSH_HOME>/repos`. */
  reposDir?: string
  /** @codo replies running at once. */
  maxAgentJobs: number
  /** Longest one @codo reply may run. */
  agentTimeoutSeconds: number
}

export const Config: z<Config> = z.object({
  dataDir: z.string(),
  reposDir: z.string(),
  maxAgentJobs: z.number().min(1).max(8).step(1).default(2),
  agentTimeoutSeconds: z.number().min(30).max(1800).default(300),
})

/**
 * Resolve a channel's repository inside the repository root.
 * @param reposRoot - absolute repository root.
 * @param repo - directory name the admin entered.
 * @returns the path relative to the root.
 */
export async function resolveRepoPath(reposRoot: string, repo: string): Promise<string> {
  const root = await realpath(reposRoot)
  const target = await realpath(resolve(root, repo)).catch(() => {
    throw new Error(`No repository called "${repo}" was found.`)
  })
  const offset = relative(root, target)
  if (offset === '' || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error('Repositories must be inside the repository folder.')
  }
  if (!(await stat(target)).isDirectory()) throw new Error('That path is not a folder.')
  return offset
}

/** Mount the routes, data store and agent runner. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const dataDir = config.dataDir ?? dshHomePath('team')
  const reposRoot = config.reposDir ?? dshHomePath('repos')
  // A deployment may mount this directory read-only, so a failure here is not fatal.
  await mkdir(reposRoot, { recursive: true }).catch(() => undefined)
  const store = await TeamStore.open(dataDir)

  const setupCodePath = join(dataDir, 'setup-code.txt')
  let setupCode: string | undefined
  if (!store.hasAccounts()) {
    setupCode = randomBytes(12).toString('base64url')
    await writeFile(setupCodePath, `${setupCode}\n`, { mode: 0o600 })
    ctx.logger.info(`team-chat: open /team and enter the setup code stored in ${setupCodePath}`)
  }

  const http: TeamHttp = new TeamHttp({
    store,
    assets: fileURLToPath(new URL('../assets', import.meta.url)),
    setupCode: () => setupCode,
    onSetupComplete: () => {
      setupCode = undefined
      void rm(setupCodePath, { force: true })
    },
    tls: () => ctx.webServer.protocol === 'https:',
    resolveRepo: repo => resolveRepoPath(reposRoot, repo),
    onMessage: (message) => {
      runner.accept(message).catch((error: unknown) => {
        ctx.logger.warn(`team-chat: @codo could not accept a message: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
  })
  const runner = new CodoRunner(ctx, {
    store, reposRoot, maxConcurrent: config.maxAgentJobs,
    timeoutMilliseconds: config.agentTimeoutSeconds * 1000,
    publish: (event) => { http.publish(event) },
  })

  ctx.effect(() => {
    const stopRoute = ctx.webServer.register({
      kind: 'prefix', path: '/team', handler: (request, response) => http.handle(request, response),
    })
    return () => {
      stopRoute()
      runner.dispose()
      http.dispose()
    }
  }, 'team-chat: routes')
}
