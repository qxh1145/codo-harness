/** Confines @codo's file tools to one repository and away from secret files. */

import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** The only tools a read-only agent keeps. */
export const READ_ONLY_TOOLS = ['read', 'grep', 'glob'] as const

const SECRET_NAMES = [
  /^\.env(\..*)?$/iu,
  /^\.(npmrc|pypirc|netrc)$/iu,
  /^credentials(\.json)?$/iu,
  /^secrets?\.(json|ya?ml|toml)$/iu,
  /^id_(rsa|ed25519|ecdsa|dsa)$/iu,
  /\.(pem|key|p12|pfx|keystore)$/iu,
]
const PUBLIC_ENV_EXAMPLE = /^\.env\.(example|sample|template)$/iu

/** Resolve symlinks in the deepest existing part of a path. */
function realPathOf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : resolve(realPathOf(parent), basename(path))
  }
}

function isInside(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}

function isBlockedSegment(segment: string): boolean {
  if (segment === '.git') return true
  return SECRET_NAMES.some(name => name.test(segment)) && !PUBLIC_ENV_EXAMPLE.test(segment)
}

/**
 * Decide whether a read-only tool call stays inside the repository.
 * @param repoRoot - absolute repository directory.
 * @param name - tool name.
 * @param args - tool arguments.
 * @returns a refusal for the model, or undefined when the call may run.
 */
export function refuseOutsideRepo(repoRoot: string, name: string, args: unknown): string | undefined {
  const fields = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const requested = name === 'read' ? fields['file_path'] : fields['path']
  if (name === 'read' && typeof requested !== 'string') return 'read needs a file path inside the repository.'
  const root = realPathOf(repoRoot)
  if (typeof requested === 'string') {
    const target = realPathOf(resolve(root, requested))
    if (!isInside(root, target)) return 'Only files inside the linked repository can be read.'
    if (relative(root, target).split(sep).some(isBlockedSegment)) return 'Secret files and Git internals cannot be read.'
  }
  for (const key of ['pattern', 'include']) {
    if (name === 'grep' && key === 'pattern') continue
    const glob = fields[key]
    if (typeof glob !== 'string') continue
    if (isAbsolute(glob) || glob.split(/[\\/]/u).includes('..')) return 'Search patterns must stay inside the repository.'
    // A ripgrep include glob can re-admit hidden files, so it never names one.
    if (glob.split(/[\\/]/u).some(segment => segment.startsWith('.') || isBlockedSegment(segment))) {
      return 'Search patterns cannot target hidden or secret files.'
    }
  }
  return undefined
}
