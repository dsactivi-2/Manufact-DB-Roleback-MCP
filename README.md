# MCP Server built with mcp-use

This is an MCP server project bootstrapped with [`create-mcp-use-app`](https://mcp-use.com/docs/typescript/getting-started/quickstart).

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000/mcp/inspector](http://localhost:3000/mcp/inspector) with your browser to test your server.

You can start building by editing the entry file. Add tools, resources, and prompts — the server auto-reloads as you edit.

Run `npm run typecheck` to refresh MCP view types and check the project with its local TypeScript compiler.

## Learn More

To learn more about mcp-use and MCP:

- [mcp-use Documentation](https://mcp-use.com/docs/typescript/getting-started/quickstart) — guides, API reference, and tutorials

## Login

Without OAuth settings, the server still expects `Authorization: Bearer` and `CRM_MCP_SERVER_TOKEN`. A token in the URL is rejected.

When `OAUTH_ISSUER` is set, the server also requires `OAUTH_AUTHORIZATION_ENDPOINT`, `OAUTH_TOKEN_ENDPOINT`, `OAUTH_JWKS_URL`, and `OAUTH_RESOURCE` or `MCP_URL`. `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` can replace those four endpoint values with the WorkOS AuthKit address. The server then publishes the OAuth discovery documents and checks signed tokens. In WorkOS mode the discovery document advertises openid, profile, email, and offline_access. It does not require crm:read at the gate. WorkOS roles are mapped to CRM scopes and checked by the handlers. A shared token is only `crm:read`; it is not an admin and cannot write. `sql:read` remains in the advertised scope list, but `crm_query` is not registered and `/v1/read/query` stays closed. `OAUTH_CLIENT_SECRET` is not a server setting.

## Deploy on Manufact Cloud

Manufact hosts this repository. The public MCP address is https://keen-forge-ldf39.run.mcp-use.com/mcp. The verified read deployment uses branch `feature/cloudflare-read-gateway-20261007` and reaches Aiven `jsicrm` through the Cloudflare Worker and Hyperdrive.

The earlier statement that deployment `c0be2dd3` was current on 6 October 2026 referred to the previous server `cloud-crm-mcp` at https://calm-forge-hk9rc.run.mcp-use.com/mcp. That address does not belong to this repository.

`CRM_TRANSPORT=cloudflare`, `CRM_WORKER_BASE_URL`, and `CRM_WORKER_SERVICE_TOKEN` connect the MCP to the Worker. The MCP does not need a database URL on this path.

The history, approval, selective restore, and outbox implementation is merged with that connection. Typed MCP history, change, restore, and approval tools are registered when `CRM_MUTATION_TOOLS_ENABLED=true`. The production Worker config keeps `WRITES_ENABLED=true`, `RESTORES_ENABLED=true`, and `REQUIRE_APPROVAL=true`. Staging keeps writes and restores off. Every business change still needs a preview, an approval, and the same idempotency key. Delete and drop are not available. See [RUNBOOK.md](RUNBOOK.md).

`npm run preflight` verifies the repository against the production Worker flags: writes and restores on, approval required, test entities off. The identity public key stays outside Git. The private `manufact-db-rollback-audit` R2 bucket, the `AUDIT_ARCHIVE` binding, and the five-minute outbox cron are deployed. `npm run preflight:activation` still fails until `config/activation-plan.local.json` is complete. Copy `config/activation-plan.example.json` only after the responsible owners provide those decisions; the local plan is ignored by Git.

Release verification commands are `npm run verify`, `npm run verify:worker`, and `npm run test:mysql`. The MySQL suite uses only the separately provisioned `rollback_test` database. After the first tools-only deployment, `npm run smoke:mutation-tools` checks tool advertisement without applying a CRM change.

Was noch eingesetzt werden muss, steht in [RUNBOOK.md](RUNBOOK.md).

```bash
npm run deploy
```
