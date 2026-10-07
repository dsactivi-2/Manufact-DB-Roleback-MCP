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

When `OAUTH_ISSUER` is set, the server also requires `OAUTH_AUTHORIZATION_ENDPOINT`, `OAUTH_TOKEN_ENDPOINT`, `OAUTH_JWKS_URL`, and `OAUTH_RESOURCE` or `MCP_URL`. `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` can replace those four endpoint values with the WorkOS AuthKit address. The server then publishes the OAuth discovery documents and checks signed tokens. In WorkOS mode the discovery document advertises openid, profile, email, and offline_access. It does not require crm:read at the gate. Only crm_query declares the OAuth scope sql:read, and no tool handler checks the WorkOS role. The shared token stays valid as a fallback and is treated as if it had every advertised CRM scope. `OAUTH_CLIENT_SECRET` is not a server setting.

## Deploy on Manufact Cloud

Manufact hosts this repository. The public MCP address is https://keen-forge-ldf39.run.mcp-use.com/mcp. Checked again on 7 October 2026: the running production deployment is `ff81c9cd-472b-4800-9ce8-d45c9b49b960`, branch `main`, commit `8b9440d9de5ead5c93f950b1a1b84c90c9a30078`. Deployment `82ea4657-f2b8-484f-b2e3-c731304eb8dc` is stopped.

The earlier statement that deployment `c0be2dd3` was current on 6 October 2026 referred to the previous server `cloud-crm-mcp` at https://calm-forge-hk9rc.run.mcp-use.com/mcp. That address does not belong to this repository.

`MCP_URL` and `OAUTH_RESOURCE` are set to https://keen-forge-ldf39.run.mcp-use.com/mcp. `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` is `balanced-lantern-65-staging.authkit.app`. `CRM_DATABASE_URL` is still not set on the running server. That is intentional until a separate test database exists. The known Aiven hosts and Hyperdrive configs `crm-mysql` and `jsimcp` are blocked in code and must not be copied here.

The Cloudflare read/write path is implemented on `feature/cloudflare-history`, not on the running `main` deployment. Without `CRM_TRANSPORT=cloudflare` the existing read tools keep their direct MySQL path. Writes and history never use that direct path. Rollback is not live. See [docs/Arbeitsstand.md](docs/Arbeitsstand.md) and [RUNBOOK.md](RUNBOOK.md).

Was noch eingesetzt werden muss, steht in [RUNBOOK.md](RUNBOOK.md).

```bash
npm run deploy
```
