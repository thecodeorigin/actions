# THECODEORIGIN Actions

Shared composite action that loads a scoped THECODEORIGIN Vault environment into a job.

## Vault environment

Store one repository secret: `THECODEORIGIN_VAULT_TOKEN`. Keep application and deployment credentials in the `thecodeorigin-co-ltd` Vault organization. Give each token access only to the project environments its workflow needs.

```yaml
- uses: thecodeorigin/actions/vault-environment@807bb07b3875b95867317f17eb0ae9c6dc20056c
  with:
    token: ${{ secrets.THECODEORIGIN_VAULT_TOKEN }}
    project: email
    environment: production
    deployment-kind: production
```

The action validates the returned scope, masks values, and writes them to the job environment. Use `keys: '["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]'` to select specific keys. Reserved runner and shell variables cannot be overwritten. The Vault token is available only to the loader step.

Each repository deploys through its own workflows. Pin callers to a reviewed full commit SHA of these actions and pass named secrets explicitly.
