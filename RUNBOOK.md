# Runbook — MCP, Cloudflare i rollback

Stanje: 7. oktobar 2026.

## Aktivne adrese

- MCP: `https://keen-forge-ldf39.run.mcp-use.com/mcp`
- Worker: `https://manufact-db-rollback.6f484zn9bd.workers.dev`
- Aiven baza: `jsicrm`
- Hyperdrive: `manufact-jsicrm-fresh` (`086fd3f6d396445eb3db0cb64f5ff9c7`)

## Tok

`ChatGPT/Codex → MCP → Cloudflare Worker → Hyperdrive → Aiven jsicrm`

Historija obuhvata promjene izvršene kroz MCP forme. Direktne izmjene drugim putem nisu dio ovog sistema. Zadužene osobe trebaju koristiti MCP forme za promjene koje moraju imati rollback trag.

## Manufact varijable

- `CRM_TRANSPORT=cloudflare`
- `CRM_WORKER_BASE_URL=https://manufact-db-rollback.6f484zn9bd.workers.dev`
- `CRM_WORKER_SERVICE_TOKEN`: tajna, ista vrijednost kao Worker `MCP_SERVICE_TOKEN`
- `CRM_IDENTITY_ASSERTION_PRIVATE_KEY`: privatni Ed25519 ključ, tajna
- postojeće MCP i OAuth varijable ostaju na hostingu

## Worker konfiguracija

- Hyperdrive binding: `HYPERDRIVE_FRESH`
- `MCP_SERVICE_TOKEN`: tajna
- `IDENTITY_ASSERTION_PUBLIC_KEY`: javni Ed25519 ključ
- `WRITES_ENABLED=false`
- `RESTORES_ENABLED=false`
- `REQUIRE_APPROVAL=true`
- `ALLOW_TEST_ENTITIES=false`

## Šta je implementirano

- tipizirane read rute bez slobodnog SQL-a
- potpisani identitet vezan za tijelo zahtjeva
- optimističke revizije entiteta i polja
- baseline i historijski događaji
- idempotentni zahtjevi
- approval vezan za korisnika i preview hash
- selektivni restore kao novi historijski događaj
- outbox koji R2 zapisuje nakon DB commita
- zabrana fizičkog `DELETE`/`DROP` toka

## Šta ostaje isključeno

- stvarni poslovni upisi i restore
- dozvoljena polja za `candidate`
- DB grantovi za poslovni update
- R2 audit bucket i automatski outbox proces
- approval forma/operaterski tok

## Redoslijed aktiviranja

1. Postaviti i provjeriti identitetski par ključeva.
2. Objaviti Worker sa write/restore zastavicama na `false` i ponoviti read smoke test.
3. Odrediti tačna polja koja MCP forme smiju mijenjati.
4. Dodijeliti minimalne grantove samo za ta polja i `rb_*` tabele.
5. Provesti preview → approval → apply → history → restore test na kontrolisanom zapisu.
6. Kreirati zaseban R2 audit bucket i provjeriti outbox retry.
7. Tek poslije uspješne provjere uključiti `WRITES_ENABLED`, a zatim posebno `RESTORES_ENABLED`.

Tajne se ne upisuju u repozitorij niti šalju u chat.
