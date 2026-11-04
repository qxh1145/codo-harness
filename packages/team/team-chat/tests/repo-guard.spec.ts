import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { refuseOutsideRepo } from '../src/repo-guard.ts'

const base = mkdtempSync(join(tmpdir(), 'team-chat-guard-'))
const repo = join(base, 'repo')
mkdirSync(join(repo, 'src'), { recursive: true })
writeFileSync(join(repo, 'src', 'app.ts'), 'export {}\n')
writeFileSync(join(base, 'outside.txt'), 'secret\n')
symlinkSync(join(base, 'outside.txt'), join(repo, 'escape.txt'))
afterAll(() => { rmSync(base, { recursive: true, force: true }) })

describe('refuseOutsideRepo', () => {
  it('allows reads and searches inside the repository', () => {
    expect(refuseOutsideRepo(repo, 'read', { file_path: 'src/app.ts' })).toBeUndefined()
    expect(refuseOutsideRepo(repo, 'read', { file_path: join(repo, 'src/app.ts') })).toBeUndefined()
    expect(refuseOutsideRepo(repo, 'grep', { pattern: 'export', path: 'src', include: '*.ts' })).toBeUndefined()
    expect(refuseOutsideRepo(repo, 'glob', { pattern: 'src/**/*.ts' })).toBeUndefined()
    expect(refuseOutsideRepo(repo, 'read', { file_path: '.env.example' })).toBeUndefined()
  })

  it.each([
    ['a parent path', { file_path: '../outside.txt' }],
    ['an absolute path', { file_path: '/etc/passwd' }],
    ['a symlink out of the repository', { file_path: 'escape.txt' }],
    ['an env file', { file_path: '.env' }],
    ['a nested env file', { file_path: 'config/.env.production' }],
    ['a private key', { file_path: 'certs/server.pem' }],
    ['Git internals', { file_path: '.git/config' }],
    ['a missing argument', {}],
  ])('refuses reading %s', (_label, args) => {
    expect(refuseOutsideRepo(repo, 'read', args)).toEqual(expect.any(String))
  })

  it.each([
    ['grep', { pattern: 'x', path: '..' }],
    ['grep', { pattern: 'x', include: '.env' }],
    ['grep', { pattern: 'x', include: '**/.env*' }],
    ['grep', { pattern: 'x', include: '../*' }],
    ['glob', { pattern: '../**' }],
    ['glob', { pattern: '/etc/*' }],
    ['glob', { pattern: '**/.git/**' }],
  ])('refuses %s %j', (tool, args) => {
    expect(refuseOutsideRepo(repo, tool, args)).toEqual(expect.any(String))
  })
})
