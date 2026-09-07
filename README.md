# THECODEORIGIN Actions

Shared Cloudflare deployment workflows and a Vault environment loader.

Store one repository secret: `THECODEORIGIN_VAULT_TOKEN`. Keep application and deployment credentials in the `thecodeorigin-co-ltd` Vault organization. Give each token access only to the project environments its workflow needs.

```yaml
- uses: thecodeorigin/actions/vault-environment@4bff26b9e9ac41c293f82a294a5eb2a262648a87
  with:
    token: ${{ secrets.THECODEORIGIN_VAULT_TOKEN }}
    project: email
    environment: production
    deployment-kind: production
```

The action validates the returned scope, masks values, and writes them to the job environment. Use `keys: '["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]'` to select specific keys. Reserved runner and shell variables cannot be overwritten. The Vault token is available only to the loader step.

Reusable workflows accept `vault-project`, `vault-environment` (default `production`), and the named `THECODEORIGIN_VAULT_TOKEN` secret. Nuxt and static builds receive only caller-declared build keys; provider credentials are rejected. Nuxt deployment validates bindings, applies migrations, and uploads runtime secrets with the Worker. Temporary secret files are removed on success or failure.

The ecosystem's production source of truth is `.cdk/index.ts`; its root workflow uses CDK to reconcile resources, applications, and seeds. Preview and standalone deployments can use these shared actions. Pin callers to a reviewed full commit SHA and pass named secrets explicitly.

Run loader checks with `node --test test/*.test.mjs`.
