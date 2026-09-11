import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configuration } from '../ecosystem-workspace/index.mjs'

const valid = {
  ECOSYSTEM_SHA: 'a'.repeat(40),
  ECOSYSTEM_PROJECT_PATH: 'apps/vault',
  ECOSYSTEM_OPERATION: 'check',
  ECOSYSTEM_CHECKOUT_TOKEN: 'secret-token',
  GITHUB_SHA: 'b'.repeat(40),
  GITHUB_WORKSPACE: '/tmp/actions-workspace',
  GITHUB_ENV: '/tmp/github-env',
}

test('accepts an exact ecosystem and child commit', () => {
  assert.deepEqual(configuration(valid), {
    ecosystemSha: 'a'.repeat(40),
    projectPath: 'apps/vault',
    projectSha: 'b'.repeat(40),
    operation: 'check',
    token: 'secret-token',
    workspace: '/tmp/actions-workspace',
    githubEnvironment: '/tmp/github-env',
  })
})

for (const [name, value, message] of [
  ['ECOSYSTEM_SHA', 'main', /full Git commit SHA/],
  ['GITHUB_SHA', 'dev', /invoking project SHA/],
  ['ECOSYSTEM_PROJECT_PATH', '../vault', /project path/],
  ['ECOSYSTEM_OPERATION', 'deploy', /operation/],
  ['ECOSYSTEM_CHECKOUT_TOKEN', 'bad\nvalue', /required/],
]) {
  test(`rejects invalid ${name}`, () => {
    assert.throws(() => configuration({ ...valid, [name]: value }), message)
  })
}
