# Cloudflare Worker

Aktivni tok čitanja je:

`MCP → Worker → Hyperdrive → Aiven jsicrm`

Worker koristi Hyperdrive `manufact-jsicrm-fresh`, isključen cache i TLS `VERIFY_IDENTITY`. Servisni token štiti sve rute. Read rute mogu koristiti zajednički MCP identitet, dok history, preview, apply i restore traže potpisani korisnički identitet.

Objedinjeni kod implementira revizije, baseline, idempotentnost, approval, događaje historije, selektivni restore i outbox. Produkcijske zastavice u wrangler.jsonc su:

- `WRITES_ENABLED=true`
- `RESTORES_ENABLED=true`
- `REQUIRE_APPROVAL=true`
- `ALLOW_TEST_ENTITIES=false`

Slobodni SQL je zatvoren. R2 binding AUDIT_ARCHIVE i petominutni cron su u produkcijskom wrangler fajlu. Staging drzi write i restore na false. Historija prati samo promjene koje prolaze kroz MCP forme.

Provjera:

```powershell
npm run typecheck
npm test
npm run build
```
