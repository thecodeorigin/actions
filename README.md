# THECODEORIGIN Actions

Pinned reusable GitHub Actions for THECODEORIGIN Cloudflare deployments.
This public repository contains code only so private repositories in the
`thecodeorigin`, `habicron`, and `zcaflare` organizations can call the same
reviewed deployment logic.

## Workflows

- `deploy-nuxt-worker.yml` builds a Nuxt Worker with only caller-declared
  build-time Doppler keys, validates its D1/KV/R2/custom-domain contract,
  applies D1 migrations, and uploads code plus runtime secrets atomically.
  When `require-email-binding` is enabled, validation also requires a local
  `EMAIL` binding plus the final `${worker-name}-ingest` producer, retrying
  ingest consumer, and `${worker-name}-ingest-dlq` consumer. A generated
  `remote` Email binding fails before migrations or deployment.
- `deploy-static-worker.yml` builds and deploys a static Worker with only the
  caller-declared build-time Doppler keys.
- `deploy-zcagent.yml` verifies and deploys zcagent with its exact runtime
  secret allowlist and generated binding contract.

Every workflow accepts a required `doppler_token` secret. Callers must pass
only that named secret; do not use `secrets: inherit`. Cloudflare credentials
and runtime secrets are read from the caller-selected Doppler project and
config. Dependency installation never receives the Doppler token, and build
processes receive only the explicitly declared build-time keys.

## Pinning

Production callers must reference a full immutable commit SHA:

```yaml
jobs:
  deploy:
    uses: thecodeorigin/actions/.github/workflows/deploy-nuxt-worker.yml@0123456789abcdef0123456789abcdef01234567
    with:
      doppler-project: example
      worker-name: example
      route-hostname: example.com
      deployment-url: https://example.com
      build-secret-names: '["CLOUDFLARE_D1_DATABASE_ID"]'
    secrets:
      doppler_token: ${{ secrets.DOPPLER_TOKEN }}
```

Review and publish a new commit before moving callers to a different SHA.
