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

Manufact is the temporary host. Deployment c0be2dd3 is the running deployment checked on 6 October 2026. The WorkOS Staging AuthKit address turns discovery on. Cloudflare remains a later option. CRM_DATABASE_URL is not a production variable yet.

```bash
npm run deploy
```
