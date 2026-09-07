import { randomBytes } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const endpoint = 'https://vault.thecodeorigin.com/api/integration/secrets/export'
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const variable = /^[A-Z][A-Z0-9_]*$/
const reserved = /^(?:GITHUB_|RUNNER_|ACTIONS_|INPUT_|THECODEORIGIN_VAULT_|LD_|DYLD_|npm_|NPM_CONFIG_|PNPM_CONFIG_)/i
const forbidden = new Set(['PATH', 'HOME', 'SHELL', 'ENV', 'BASH_ENV', 'NODE_OPTIONS', 'NODE_PATH', 'IFS', 'CDPATH', 'PYTHONPATH', 'RUBYOPT', 'PERL5OPT', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_SSH', 'GIT_SSH_COMMAND', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseScope(input) {
  if (!object(input)) throw new Error('Invalid Vault scope')
  const scope = {}
  for (const name of ['organizationSlug', 'projectSlug', 'environmentSlug']) {
    if (typeof input[name] !== 'string' || input[name].length > 100 || !slug.test(input[name])) throw new Error(`Invalid Vault ${name}`)
    scope[name] = input[name]
  }
  if (input.kind !== undefined) {
    const allowed = input.kind === 'production' ? ['production'] : input.kind === 'preview' ? ['development', 'staging', 'preview'] : []
    if (!allowed.includes(scope.environmentSlug)) throw new Error('Vault environment does not match deployment kind')
  }
  return scope
}

export async function readVaultEnvironment(input, token, fetcher = fetch) {
  const scope = parseScope(input)
  if (typeof token !== 'string' || !token || /[\r\n\0]/.test(token)) throw new Error('Missing or invalid THECODEORIGIN_VAULT_TOKEN')
  let response
  try {
    response = await fetcher(endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(scope), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    })
  } catch { throw new Error('Vault environment request failed') }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Vault environment request failed (${response.status})`)
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid Vault response type')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty Vault response')
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 10 * 1024 * 1024) throw new Error('Vault response exceeds limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  let result
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('Invalid Vault response') }
  if (!object(result) || Object.entries(scope).some(([key, value]) => result[key] !== value)) throw new Error('Vault returned a different scope')
  if (['organizationId', 'projectId', 'environmentId'].some(key => typeof result[key] !== 'string' || !result[key])
    || !Number.isSafeInteger(result.revision) || result.revision < 0 || !object(result.secrets)) throw new Error('Invalid Vault response')
  for (const [key, value] of Object.entries(result.secrets)) {
    if (!variable.test(key) || typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid Vault environment entry')
  }
  return result.secrets
}

export function githubEnvironment(values, keys) {
  if (!object(values)) throw new Error('Invalid environment')
  if (keys !== undefined && (!Array.isArray(keys) || keys.some(key => typeof key !== 'string') || new Set(keys).size !== keys.length)) throw new Error('Keys must be a JSON array of distinct environment names')
  const result = {}
  for (const key of keys ?? Object.keys(values)) {
    if (!variable.test(key) || reserved.test(key) || forbidden.has(key)) throw new Error(`Cannot export reserved environment variable ${key}`)
    if (!Object.hasOwn(values, key)) throw new Error(`Missing Vault key ${key}`)
    const value = values[key]
    if (typeof value !== 'string' || value.includes('\0')) throw new Error(`Invalid Vault value for ${key}`)
    result[key] = value
  }
  return result
}

function mask(value, log) {
  if (!value) return
  log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
  for (const line of value.split(/\r?\n/)) {
    if (line.length >= 8 && line !== value) log(`::add-mask::${line.replaceAll('%', '%25')}`)
  }
}

export async function exportEnvironment(values, { file = process.env.GITHUB_ENV, keys, log = console.log } = {}) {
  const selected = githubEnvironment(values, keys)
  if (!file) throw new Error('GITHUB_ENV is required')
  for (const value of Object.values(selected)) mask(value, log)
  const text = Object.entries(selected).map(([key, value]) => {
    let delimiter
    do { delimiter = `vault_${randomBytes(24).toString('hex')}` } while (value.includes(delimiter))
    return `${key}<<${delimiter}\n${value}\n${delimiter}\n`
  }).join('')
  await appendFile(file, text, { mode: 0o600 })
  return Object.keys(selected).length
}

export async function main(environment = process.env) {
  const scope = parseScope({ organizationSlug: environment.VAULT_ORGANIZATION, projectSlug: environment.VAULT_PROJECT, environmentSlug: environment.VAULT_ENVIRONMENT, kind: environment.VAULT_DEPLOYMENT_KIND || undefined })
  let keys
  try { keys = environment.VAULT_KEYS ? JSON.parse(environment.VAULT_KEYS) : undefined }
  catch { throw new Error('VAULT_KEYS must be a JSON array') }
  const values = await readVaultEnvironment(scope, environment.THECODEORIGIN_VAULT_TOKEN)
  const count = await exportEnvironment(values, { file: environment.GITHUB_ENV, keys })
  console.log(`Loaded ${count} environment variables from Vault ${scope.projectSlug}/${scope.environmentSlug}.`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
