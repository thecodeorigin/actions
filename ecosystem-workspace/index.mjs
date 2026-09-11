import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const projectPattern = /^(?:apps|packages|configs)\/[a-z0-9][a-z0-9-]*$/

export function configuration(environment = process.env) {
  const ecosystemSha = environment.ECOSYSTEM_SHA ?? ''
  const projectPath = environment.ECOSYSTEM_PROJECT_PATH ?? ''
  const projectSha = environment.GITHUB_SHA ?? ''
  const operation = environment.ECOSYSTEM_OPERATION ?? ''
  const token = environment.ECOSYSTEM_CHECKOUT_TOKEN ?? ''
  const workspace = resolve(environment.GITHUB_WORKSPACE ?? '')
  if (!shaPattern.test(ecosystemSha)) throw new Error('ecosystem-sha must be a full Git commit SHA')
  if (!shaPattern.test(projectSha)) throw new Error('The invoking project SHA must be a full Git commit SHA')
  if (!projectPattern.test(projectPath)) throw new Error('Invalid ecosystem project path')
  if (!['', 'check', 'build'].includes(operation)) throw new Error('operation must be check, build, or empty')
  if (!token || token.trim() !== token || /[\r\n\0]/.test(token)) throw new Error('ECOSYSTEM_CHECKOUT_TOKEN is required')
  if (!environment.GITHUB_WORKSPACE || workspace === '/') throw new Error('GITHUB_WORKSPACE is required')
  if (!environment.GITHUB_ENV) throw new Error('GITHUB_ENV is required')
  return { ecosystemSha, projectPath, projectSha, operation, token, workspace, githubEnvironment: environment.GITHUB_ENV }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}

export function main(environment = process.env) {
  const config = configuration(environment)
  const checkout = join(config.workspace, 'ecosystem')
  const temporary = mkdtempSync(join(tmpdir(), 'ecosystem-action-'))
  const askpass = join(temporary, 'askpass.sh')
  try {
    mkdirSync(checkout, { recursive: true })
    writeFileSync(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf \'%s\\n\' x-access-token ;;\n  *Password*) printf \'%s\\n\' "$ECOSYSTEM_CHECKOUT_TOKEN" ;;\n  *) exit 1 ;;\nesac\n', { mode: 0o700 })
    chmodSync(temporary, 0o700)
    const checkoutEnvironment = {
      PATH: environment.PATH,
      HOME: environment.HOME,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: askpass,
      GIT_ALLOW_PROTOCOL: 'https',
      ECOSYSTEM_CHECKOUT_TOKEN: config.token,
    }
    run('git', ['init', '--quiet'], { cwd: checkout, env: checkoutEnvironment })
    run('git', ['remote', 'add', 'origin', 'https://github.com/thecodeorigin/ecosystem.git'], { cwd: checkout, env: checkoutEnvironment })
    run('git', ['-c', 'credential.helper=', '-c', 'http.followRedirects=false', 'fetch', '--quiet', '--depth=1', '--no-tags', 'origin', config.ecosystemSha], { cwd: checkout, env: checkoutEnvironment })
    run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: checkout, env: checkoutEnvironment })
    run('node', ['.github/scripts/checkout-projects.mjs'], {
      cwd: checkout,
      env: {
        ...checkoutEnvironment,
        GITHUB_SHA: config.ecosystemSha,
        EXPECTED_PROJECT_PATH: config.projectPath,
        EXPECTED_PROJECT_COMMIT: config.projectSha,
      },
    })
    appendFileSync(config.githubEnvironment, 'ECOSYSTEM_CHECKOUT_TOKEN=\n', { mode: 0o600 })
    const buildEnvironment = { ...environment }
    delete buildEnvironment.ECOSYSTEM_CHECKOUT_TOKEN
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: checkout, env: buildEnvironment })
    if (config.operation) run('node', ['scripts/workspace/run.mjs', config.operation, config.projectPath], { cwd: checkout, env: buildEnvironment })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main() } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
