# Cloudflare Worker

Aktivni tok čitanja je:

`MCP → Worker → Hyperdrive → Aiven jsicrm`

Worker koristi Hyperdrive `manufact-jsicrm-fresh`, isključen cache i TLS `VERIFY_IDENTITY`. Servisni token štiti sve rute. Read rute mogu koristiti zajednički MCP identitet, dok history, preview, apply i restore traže potpisani korisnički identitet.

Objedinjeni kod implementira revizije, baseline, idempotentnost, approval, događaje historije, selektivni restore i outbox. Produkcijske zastavice ostaju:

- `WRITES_ENABLED=false`
- `RESTORES_ENABLED=false`
- `REQUIRE_APPROVAL=true`
- `ALLOW_TEST_ENTITIES=false`

Slobodni SQL je zatvoren. R2 još nije povezan. Historija prati samo promjene koje prolaze kroz MCP forme.

Provjera:

```powershell
npm run typecheck
npm test
npm run build
```
