# Runbook — MCP, Cloudflare i rollback

Stanje: 14. oktobar 2026. Produkcijski Worker ima upise i restore ukljucene, uz obavezan approval. Staging ostaje iskljucen.

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
- `CRM_MUTATION_TOOLS_ENABLED=true` oglasava history, change, restore i approval alate. Bez te zastavice alati se ne registruju
- `CRM_IDENTITY_ASSERTION_PRIVATE_KEY`: privatni Ed25519 ključ, tajna
- postojeće MCP i OAuth varijable ostaju na hostingu

## Izolovani testovi od 13. oktobra 2026.

- Posebna Aiven baza `rollback_test` koristi zasebnog korisnika bez grantova na `jsicrm`.
- `npm run test:mysql` izvršava testove serijski jer oba scenarija resetuju iste testne `rb_*` tabele.
- MySQL paket prolazi 4/4: historija i ponovljivost, konflikt dvije konekcije, puni Worker HTTP tok te puni OAuth/MCP/Worker/MySQL preview/approval/apply/history/restore tok.
- Glavni paket prolazi 31/31, Worker 7/7, oba typechecka, MCP build i Worker dry-run prolaze.
- Nije izvršen produkcijski deploy niti produkcijski write.

## Worker konfiguracija

- Hyperdrive binding: `HYPERDRIVE_FRESH`
- `MCP_SERVICE_TOKEN`: tajna
- `IDENTITY_ASSERTION_PUBLIC_KEY`: javni Ed25519 ključ
- `WRITES_ENABLED=true` u cloudflare/worker/wrangler.jsonc
- `RESTORES_ENABLED=true` u istom fajlu; staging ostaje na false
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


## Sta i dalje nije dostupno

- fizicki DELETE i DROP
- slobodni SQL na /v1/read/query
- scoring, fotografije i biometrija
- zajednicki MCP token ne moze pisati niti odobravati

## Redoslijed aktiviranja

1. Postaviti i provjeriti identitetski par ključeva.
2. Objaviti Worker sa write/restore iskljucenim write/restore zastavicama. Trenutni produkcijski wrangler.jsonc ih drzi na true.
3. Odrediti tačna polja koja MCP forme smiju mijenjati.
4. Dodijeliti minimalne grantove samo za ta polja i `rb_*` tabele.
5. Provesti preview → approval → apply → history → restore test na kontrolisanom zapisu.
6. Na prvom odobrenom događaju provjeriti da deployani cron `*/5 * * * *` premješta outbox status u `archived` i zapisuje `events/<event_id>.json` u bucket `manufact-db-rollback-audit`.
7. Produkcijski wrangler.jsonc vec ima WRITES_ENABLED i RESTORES_ENABLED na true. Novi upis ide kroz preview, approval i isti idempotency key.

## Obavezni preflight i release postupak

1. `npm run preflight` mora proći sa zaključanim produkcijskim zastavicama.
2. Kopirati `config/activation-plan.example.json` u ignorisani `config/activation-plan.local.json` tek kada odgovorne osobe dostave odluke.
3. `npm run verify`, `npm run verify:worker` i `npm run test:mysql` moraju proći na istom kandidatu za release.
4. `npm run preflight:activation` mora proći prije bilo kakve aktivacije.
5. Prvo objaviti samo MCP mutation alate, uz Worker write i restore zastavice usklađenim sa wrangler.jsonc: writes i restores su true, approval je obavezan.
6. Pokrenuti `npm run smoke:mutation-tools` sa `MCP_URL` i `MCP_ACCESS_TOKEN`; ovaj smoke ne mijenja CRM podatke.
7. Nakon odobrenog zapisa i approval toka posebno uključiti write, provesti jedan kontrolisani test i odmah ponovo zaključati pri bilo kakvoj grešci.
8. Restore je ukljucen uz write i i dalje trazi approval. Iskljucuje se posebno, prije write zastavice.
9. R2 binding i cron aktivirati zasebno; prije deploya potvrditi da produkcijska baza ima `rb_events` i `rb_outbox`, a poslije deploya provjeriti da pending outbox prelazi u `archived`.

Rollback redoslijed je obrnut: prvo `RESTORES_ENABLED=false`, zatim `WRITES_ENABLED=false`, zatim `CRM_MUTATION_TOOLS_ENABLED=false`. Outbox događaji ostaju u MySQL-u i ne brišu se.

Tajne se ne upisuju u repozitorij niti šalju u chat.
