# Cloudflare gateway — korak povezivanja

Ovaj paket dodaje autentificirane tipizirane rute čitanja preko Hyperdrivea.
Ne implementira još upis, historiju, restore ni R2 obradu. Oba prekidača ostaju false.

1. Cloudflare prijava: npx wrangler login
2. Potvrditi račun 2f8c7ae79d6d316eac3961585f5c2f5b.
3. Napraviti novi Hyperdrive na Aiven jsicrm, cache disabled, TLS VERIFY_IDENTITY.
4. Unijeti njegov stvarni ID umjesto REPLACE_WITH_NEW_HYPERDRIVE_ID.
5. Postaviti secret MCP_SERVICE_TOKEN.
6. npm run typecheck; npm run build; npm run deploy.
7. Na novom Manufact MCP-u postaviti CRM_TRANSPORT=cloudflare,
   CRM_WORKER_BASE_URL i odgovarajući CRM_WORKER_SERVICE_TOKEN; objaviti razvojnu granu.

GET /health je javna provjera procesa i ne dokazuje DB vezu.
POST /v1/read/stats s ispravnim servisnim tokenom provjerava DB put.
Ostale rute: candidates, companies, orders, professions, resolve_profession, profile, tables, describe.
Slobodni query privremeno vraća SQL_GATEWAY_DISABLED: treba parser i izričite dozvoljene kolone prije otvaranja na gatewayu.
Vodiči MCP-a ostaju lokalni resursi.

Nema direktnih DB tajni u MCP-u kada CRM_TRANSPORT=cloudflare.
Servisni token nije korisnička dozvola upisa. Upise ne aktivirati prije zasebne provjerene implementacije.
