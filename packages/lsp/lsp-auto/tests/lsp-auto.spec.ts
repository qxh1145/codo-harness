import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, installedServers } from '../src/index.ts'

const server = (command: string) => ({ command, args: [], env: {}, extensionToLanguage: { '.x': 'x' } })

/** A context whose PATH holds only `present`. */
function contextWith(present: readonly string[]) {
  const plugin = vi.fn((..._args: unknown[]) => ({ await: () => Promise.resolve() }))
  const info = vi.fn()
  const resolveExecutable = vi.fn((command: string) =>
    present.includes(command) ? Promise.resolve(`/bin/${command}`) : Promise.reject(new Error('not found')))
  const ctx = { plugin, logger: { info }, subprocess: { resolveExecutable } } as unknown as Context
  return { ctx, plugin, info }
}

describe('installedServers', () => {
  it('keeps installed servers and names the missing ones', async () => {
    const result = await installedServers({ typescript: 'tsserver', java: 'jdtls' }, command => Promise.resolve(command === 'tsserver'))
    expect(result).toEqual({ installed: { typescript: 'tsserver' }, missing: ['java'] })
  })

  it('returns nothing when no server is installed', async () => {
    expect(await installedServers({ java: 'jdtls' }, () => Promise.resolve(false)))
      .toEqual({ installed: {}, missing: ['java'] })
  })
})

describe('apply', () => {
  const servers = { typescript: server('tsserver'), java: server('jdtls') }

  it('mounts the provider with installed servers only, then the tool', async () => {
    const { ctx, plugin, info } = contextWith(['tsserver'])
    await apply(ctx, { servers } as never)
    expect(plugin).toHaveBeenCalledTimes(2)
    expect(plugin.mock.calls[0]?.[1]).toEqual({ servers: { typescript: servers.typescript } })
    expect(info).toHaveBeenCalledWith('lsp-auto: not installed, skipped: java')
  })

  it('mounts neither the provider nor the tool when nothing is installed', async () => {
    const { ctx, plugin } = contextWith([])
    await apply(ctx, { servers } as never)
    expect(plugin).not.toHaveBeenCalled()
  })

  it('logs nothing when every server is installed', async () => {
    const { ctx, plugin, info } = contextWith(['tsserver', 'jdtls'])
    await apply(ctx, { servers } as never)
    expect(plugin).toHaveBeenCalledTimes(2)
    expect(info).not.toHaveBeenCalled()
  })
})
