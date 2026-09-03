import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, test } from 'node:test'

const workflow = readFileSync(new URL('./deploy-nuxt-worker.yml', import.meta.url), 'utf8')
const match = workflow.match(/\/\/ EMAIL_DEPLOYMENT_CONTRACT_SCRIPT_START\n([\s\S]*?)\n\s*\/\/ EMAIL_DEPLOYMENT_CONTRACT_SCRIPT_END/)

test('the reusable workflow exposes an executable Email deployment contract', () => {
  assert.ok(match, 'missing Email deployment contract script markers')
})

if (match) {
  const script = match[1].replace(/^\s{10}/gm, '')
  const directory = mkdtempSync(join(tmpdir(), 'email-deploy-contract-'))
  const configPath = join(directory, 'wrangler.json')
  const worker = 'thecodeorigin-email-platform'

  function validConfig() {
    return {
      send_email: [{ name: 'EMAIL' }],
      queues: {
        producers: [{ binding: 'MAIL_INGEST_QUEUE', queue: `${worker}-ingest` }],
        consumers: [
          {
            queue: `${worker}-ingest`,
            max_retries: 5,
            dead_letter_queue: `${worker}-ingest-dlq`,
          },
          { queue: `${worker}-ingest-dlq` },
        ],
      },
    }
  }

  function validate(config) {
    writeFileSync(configPath, JSON.stringify(config))
    return spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EMAIL_CONTRACT_CONFIG: configPath,
        EMAIL_CONTRACT_WORKER: worker,
      },
    })
  }

  before(() => writeFileSync(configPath, JSON.stringify(validConfig())))
  after(() => rmSync(directory, { recursive: true, force: true }))

  test('accepts the final local Email binding and complete ingest topology', () => {
    assert.equal(validate(validConfig()).status, 0)
  })

  test('rejects a remote production Email binding', () => {
    const config = validConfig()
    config.send_email[0].remote = true
    const result = validate(config)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /remote/)
  })

  for (const [name, mutate] of [
    ['producer', config => config.queues.producers.splice(0)],
    ['ingest consumer', config => config.queues.consumers.splice(0, 1)],
    ['DLQ consumer', config => config.queues.consumers.splice(1, 1)],
  ]) {
    test(`rejects a missing ${name}`, () => {
      const config = validConfig()
      mutate(config)
      assert.notEqual(validate(config).status, 0)
    })
  }
}
