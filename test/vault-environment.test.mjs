import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { exportEnvironment, githubEnvironment, parseScope, readVaultEnvironment } from '../vault-environment/index.mjs'

const scope = { organizationSlug: 'thecodeorigin-co-ltd', projectSlug: 'email', environmentSlug: 'production' }
const payload = secrets => ({ ...scope, organizationId: 'org', projectId: 'project', environmentId: 'env', revision: 3, secrets })

test('validates fixed slug scopes and rejects production preview confusion', () => {
  assert.deepEqual(parseScope(scope), scope)
  assert.throws(() => parseScope({ ...scope, projectSlug: '../email' }))
  assert.throws(() => parseScope({ ...scope, environmentSlug: 'production', kind: 'preview' }))
  assert.deepEqual(parseScope({ ...scope, environmentSlug: 'development', kind: 'preview' }), { ...scope, environmentSlug: 'development' })
})
test('exports only matching authenticated scope with bounded no-redirect request', async () => {
  let request
  const result = await readVaultEnvironment(scope, 'private-token', async (url, options) => {
    request = { url, options }
    return Response.json(payload({ NUXT_AUTH_SECRET: 'value' }))
  })
  assert.deepEqual(result, { NUXT_AUTH_SECRET: 'value' })
  assert.equal(request.url, 'https://vault.thecodeorigin.com/api/integration/secrets/export')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.headers.authorization, 'Bearer private-token')
  assert.deepEqual(JSON.parse(request.options.body), scope)
  await assert.rejects(readVaultEnvironment(scope, 'private-token', async () => Response.json({ ...payload({}), projectSlug: 'vault' })), /scope/)
  await assert.rejects(readVaultEnvironment(scope, 'private-token', async () => new Response('private-value', { status: 401 })), error => !error.message.includes('private-value'))
})
test('rejects reserved environment keys, prototype pollution and non-string values before writes', () => {
  for (const key of ['PATH', 'NODE_OPTIONS', 'GITHUB_TOKEN', 'GITHUB_ENV', 'RUNNER_TEMP', 'THECODEORIGIN_VAULT_TOKEN', 'LD_PRELOAD', 'BASH_ENV', '__proto__']) {
    assert.throws(() => githubEnvironment(JSON.parse(`{"${key}":"unsafe"}`)))
  }
  assert.throws(() => githubEnvironment({ NUXT_AUTH_SECRET: 4 }))
  assert.throws(() => githubEnvironment({ NUXT_AUTH_SECRET: 'bad\0value' }))
})
test('masks multiline values before writing delimited GitHub environment without injection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vault-action-test-'))
  try {
    const file = join(directory, 'github-env')
    const messages = []
    const values = { NUXT_AUTH_SECRET: 'first\n::warning::injected\nlast', NUXT_EMPTY: '' }
    await exportEnvironment(values, { file, log: value => messages.push(value) })
    const output = await readFile(file, 'utf8')
    assert.match(output, /^NUXT_AUTH_SECRET<<vault_[a-f0-9]+\nfirst\n::warning::injected\nlast\nvault_[a-f0-9]+\n/)
    assert(messages[0].startsWith('::add-mask::first%0A'))
    assert(!messages.some(value => value.includes('\n::warning::')))
    assert.match(output, /NUXT_EMPTY<</)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('explicit key selection never writes checkout credentials that were not requested', () => {
  assert.deepEqual(githubEnvironment({ CDK_CHECKOUT_TOKEN: 'private', NUXT_AUTH_SECRET: 'runtime' }, ['NUXT_AUTH_SECRET']), { NUXT_AUTH_SECRET: 'runtime' })
  assert.throws(() => githubEnvironment({ NUXT_AUTH_SECRET: 'runtime' }, ['MISSING']), /Missing/)
})
