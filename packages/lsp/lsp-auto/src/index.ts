/**
 * Mount only the language servers installed on this machine. A deployment can list servers for
 * several languages without a missing one stopping the rest, and with none installed the model
 * receives no `lsp` tool, so it pays no tokens for a tool that cannot work.
 *
 * @module @deepseek-ai/dsh-lsp-auto
 */

import type { Context } from '@deepseek-ai/cordis'
import * as LspStdio from '@deepseek-ai/dsh-lsp-stdio'
import type {} from '@deepseek-ai/dsh-subprocess'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'

export const name = 'lsp-auto'
export const inject = ['fs', 'lsp', 'subprocess', 'systemPrompt', 'tools', 'workingDirectory']

/** Same shape as `dsh-lsp-stdio`: one entry per language server. */
export type Config = LspStdio.Config
export const Config = LspStdio.Config

/**
 * Keep the servers whose command resolves.
 * @param servers - configured servers by id.
 * @param isInstalled - answers whether one server's command can be launched.
 * @returns the installed servers and the ids left out.
 */
export async function installedServers<T>(
  servers: Readonly<Record<string, T>>,
  isInstalled: (server: T) => Promise<boolean>,
): Promise<{ readonly installed: Record<string, T>; readonly missing: string[] }> {
  const installed: Record<string, T> = {}
  const missing: string[] = []
  for (const [id, server] of Object.entries(servers)) {
    if (await isInstalled(server)) installed[id] = server
    else missing.push(id)
  }
  return { installed, missing }
}

/** Mount the provider and the model tool for whatever is installed. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const { installed, missing } = await installedServers(config.servers, async (server) => {
    try {
      await ctx.subprocess.resolveExecutable(server.command, server.env ?? {})
      return true
    } catch {
      return false
    }
  })
  if (missing.length > 0) ctx.logger.info(`lsp-auto: not installed, skipped: ${missing.join(', ')}`)
  if (Object.keys(installed).length === 0) return
  await ctx.plugin(LspStdio, { servers: installed }).await()
  await ctx.plugin(ToolLsp, {}).await()
}
