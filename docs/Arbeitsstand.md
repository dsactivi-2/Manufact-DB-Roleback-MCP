# Radno stanje — Cloudflare historija i rollback

Datum: 7. oktobar 2026.
Grana: `feature/cloudflare-read-gateway-20261007`.

## Potvrđeno uživo

- Aiven baza je `jsicrm`; backup je napravljen prije DDL promjena.
- Sedam praznih `rb_*` tabela postoji u `jsicrm`. Poslovne tabele nisu izmijenjene.
- Worker je `https://manufact-db-rollback.6f484zn9bd.workers.dev`.
- Hyperdrive `manufact-jsicrm-fresh` (`086fd3f6d396445eb3db0cb64f5ff9c7`) koristi TLS `VERIFY_IDENTITY`, Aiven CA i isključen cache.
- Runtime korisnik ima ograničena prava; `avnadmin` se ne koristi u Workeru.
- MCP je `https://keen-forge-ldf39.run.mcp-use.com/mcp`.
- Poziv `crm_stats` prošao je putem MCP → Worker → Hyperdrive → Aiven.
- Sve specijalizirane read rute vraćaju uspješan odgovor. Slobodni SQL ostaje zatvoren.

## Objedinjena implementacija

- Nacrt historije, revizija, baselinea, idempotentnosti, approvala, selektivnog restorea i outboxa spojen je sa postojećom Cloudflare vezom.
- Read i history alati koriste isti Worker i isti Hyperdrive binding.
- MCP šalje kratkotrajni Ed25519 dokaz identiteta vezan za tijelo zahtjeva.
- Zajednički MCP token dobija samo `crm:read`; ne može primijeniti promjenu ni restore.
- Poslovni upis, događaj historije, stanje revizije, idempotency rezultat i outbox ulaze u istu MySQL transakciju.
- Fizički `DELETE` i `DROP` nisu dostupni kroz Worker rute.
- R2 se piše nakon potvrđene MySQL transakcije; neuspjela arhiva ostavlja outbox zapis za ponavljanje.

## Važeća granica praćenja

Historija obuhvata samo promjene koje prolaze kroz MCP forme. Direktne izmjene drugim putem neće biti automatski evidentirane. Korisnik je potvrdio da će zadužene osobe CRM promjene raditi kroz MCP forme, pa integracija Hetzner CRM koda nije u ovom opsegu.

## Sigurnosno stanje

- `WRITES_ENABLED=false`.
- `RESTORES_ENABLED=false`.
- `REQUIRE_APPROVAL=true`.
- `ALLOW_TEST_ENTITIES=false`.
- Ed25519 par je generisan; privatni i javni ključ su spremljeni kao hosting tajne.
- Ograničeni Worker korisnik ima SELECT na `rb_*` tabelama za pregled historije.
- Prava za stvarne poslovne upise i lista dozvoljenih polja još nisu aktivirani.
- R2 bucket još nije povezan.

## Preostalo

Objedinjeni Worker je objavljen kao verzija `a4b402e6-c191-4eda-a4d7-a9a96d2fe25e`. Sve specijalizirane read rute i agregatni stats vraćaju 200. Potpisani history-list vraća 200, a apply vraća `WRITES_DISABLED` (403).

Objedinjeni MCP deployment `4c699590-2d2f-4c0e-aec7-0768b5bef18c` pokrenut je sa commitom `9d8abd6`. Javni `crm_stats` i potpisani `crm_history_list` vraćaju 200 kroz cijeli tok.

1. Odrediti tačna polja koja MCP forme smiju mijenjati i dodijeliti minimalna DB prava.
2. Završiti approval formu i provesti kontrolisani preview/apply/history/restore test.
3. Kreirati zaseban R2 audit bucket i povezati outbox obradu.
