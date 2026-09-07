import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const workflow = name => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')

for (const name of ['deploy-nuxt-worker', 'deploy-static-worker']) {
  const source = workflow(name)
  const script = source.match(/          node <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .replace(/^          /gm, '')
  function runBuild(values, buildError) {
    let invoked = false
    let removed = false
    let environment
    const process = { env: { PATH: '/bin', CI: 'true', BUILD_SECRETS_FILE: '/tmp/fixture', NUXT_AUTH_SECRET: 'runtime', CLOUDFLARE_API_TOKEN: 'cloudflare', THECODEORIGIN_VAULT_TOKEN: 'vault' } }
    const require = name => name === 'node:fs'
      ? { readFileSync: () => JSON.stringify(values), unlinkSync: () => { removed = true } }
      : { spawnSync: (command, args, options) => {
          invoked = true
          assert.equal(command, 'pnpm')
          assert.equal(JSON.stringify(args), JSON.stringify(['build']))
          assert.equal(options.shell, false)
          environment = options.env
          if (buildError) throw buildError
          return { status: 0 }
        } }
    let error
    try { runInNewContext(script, { require, process }) }
    catch (caught) { error = caught }
    return { invoked, removed, environment, error }
  }

  test(`${name} exposes only declared build values and removes its temporary file`, () => {
    const result = runBuild({ NUXT_PUBLIC_BASE_DOMAIN: 'example.com', CLOUDFLARE_D1_DATABASE_ID: 'db' })
    assert.equal(result.error, undefined)
    assert.equal(result.invoked, true)
    assert.equal(result.removed, true)
    assert.deepEqual(Object.fromEntries(Object.entries(result.environment)), {
      PATH: '/bin', CI: 'true', NUXT_PUBLIC_BASE_DOMAIN: 'example.com', CLOUDFLARE_D1_DATABASE_ID: 'db',
    })
    assert.equal(runBuild({}, new Error('build failed')).removed, true)
    assert.match(source, /umask 077/)
    assert.match(source, /trap 'rm -f "\$build_file"' EXIT/)
  })

  test(`${name} rejects explicitly allowlisted provider credentials before starting a build`, () => {
    for (const key of ['THECODEORIGIN_VAULT_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_D1_TOKEN', 'GITHUB_TOKEN', 'SSH_DEPLOY_KEY', 'CF_ACCESS_CLIENT_SECRET']) {
      const result = runBuild({ [key]: 'secret' })
      assert.match(result.error.message, /Provider credentials/)
      assert.equal(result.invoked, false)
      assert.equal(result.removed, true)
    }
  })
}

test('zcagent verifies and builds before loading private runtime credentials', () => {
  const source = workflow('deploy-zcagent')
  const load = source.indexOf('- name: Load production environment from Vault')
  for (const command of ['- run: pnpm verify', '- run: pnpm build']) {
    assert.ok(source.indexOf(command) > 0)
    assert.ok(source.indexOf(command) < load)
  }
  assert.match(source, /trap 'rm -f "\$runtime_file"' EXIT/)
  assert.match(source, /--secrets-file "\$runtime_file"/)
})

test('reusable deployments accept only the scoped Vault token as a caller secret', () => {
  for (const name of ['deploy-nuxt-worker', 'deploy-static-worker', 'deploy-zcagent']) {
    const source = workflow(name)
    const references = [...source.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1])
    assert.deepEqual(references, ['THECODEORIGIN_VAULT_TOKEN'])
    assert.doesNotMatch(source, /doppler (?:run|secrets)|dopplerhq\/cli-action/)
    assert.match(source, /deployment-kind: production/)
  }
})
