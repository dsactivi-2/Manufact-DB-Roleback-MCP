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

Manufact hosts this repository. The running production deployment is `cbbcab9c-581e-448e-9913-1b3c2c348232` on branch `main`, checked on 7 October 2026. Its public MCP address is https://keen-forge-ldf39.run.mcp-use.com/mcp.

The earlier statement that deployment `c0be2dd3` was current on 6 October 2026 referred to the previous server `cloud-crm-mcp` at https://calm-forge-hk9rc.run.mcp-use.com/mcp. That address does not belong to this repository.

WorkOS discovery is not enabled on this deployment. The saved production variable names are `CRM_MCP_SERVER_TOKEN`, `MCP_URL`, and `CSP_URLS`; their values were not copied into this document. `CRM_DATABASE_URL` is still not set, so CRM tools cannot reach a database yet. Cloudflare remains a later option.

Was noch eingesetzt werden muss, steht in [RUNBOOK.md](RUNBOOK.md).

```bash
npm run deploy
```
