# Radno stanje — Cloudflare povezivanje

Datum: 7. oktobar 2026.
Grana: feature/cloudflare-history.
Cilj korisnika: povezati novi MCP s aktivnom Aiven jsicrm kroz Cloudflare.
Korisnik odobrio direktni rad na jsicrm; CRM kod na Hetzneru ostaje za kasnije.

## Baza — prethodno zavrseno

Na Aiven jsicrm primijenjena migracija 001 iz radnog foldera.
180 poslovnih + 7 novih praznih rb_ tabela = 187. Nema triggera.
To jos ne evidentira CRM promjene niti omogucava rollback.

## Zavrseno u ovoj fazi

- Napravljena razvojna grana; nije pushana ni objavljena.
- Instalirane MCP i Worker zavisnosti, oba lockfilea.
- contracts/read.ts: stroge tipizirane sheme deset poslovnih operacija.
- src/worker-client.ts: autentificirani HTTPS prevoz bez direktnog DB URL-a.
- index.ts: CRM_TRANSPORT=cloudflare usmjerava postojeca citanja kroz Worker.
  Bez tog parametra zadrzan je direktni legacy prevoz.
- cloudflare/worker: Worker paket, Hyperdrive DB adapter, health i read rute.
- Hyperdrive konekcija mora ciljati jsicrm, bez multi-statements.
- Svaki read zahtjev koristi read-only transakciju i zatvara konekciju.
- Worker odbija neprijavljene pozive, nepoznata polja i preveliko tijelo.
- Sigurne greske ne vracaju lozinke, SQL ni zapise kandidata.
- Nalozi koriste stvarnu kolonu nalog_naziv, uz izlazni alias nalog_naslov.
- Dodane ignore oznake za .dev.vars, .wrangler i .build.
- Slobodni crm_query u novom gateway rezimu trenutno je zatvoren
  (SQL_GATEWAY_DISABLED) dok ne dobije parser i dozvoljene kolone.
  Direktni prevoz nije promijenio postojece SQL ponasanje.

## Stvarno izvrsene provjere

MCP puni regresijski test: 21/21 prosao prije dodavanja dodatnog E2E testa.
MCP adapter test suite nakon dodatka: 6/6 prosao, ukljucujuci pravi
initialize + tools/call crm_stats → HTTP adapter → Worker handler s mock bazom.
Ukupno u repozitoriju sada 22 test slucaja.
MCP typecheck i build: prosli.
Worker HTTP testovi: 6/6 prosli.
Worker typecheck: prosao nakon uskladjivanja TextDecoder ignoreBOM tipa.
Worker wrangler deploy --dry-run: prosao, bez objave.

Nisu izvrseni online Hyperdrive testovi ni Worker upiti produkcijskoj bazi.

## Trenutni preduslov

Wrangler 4.148.0 whoami vraca: not authenticated.
Korisniku je poslan prvi korak:
npx --yes wrangler@4.148.0 login
Prijavu treba dovrsiti u pregledniku, na racunu projekta.
Tajne se ne salju u chat.

## Tacan sljedeci korak nakon prijave

1. wrangler whoami i potvrda racuna 2f8c7ae79d6d316eac3961585f5c2f5b.
2. Napraviti vlastiti DB runtime korisnik, poceti samo SELECT pravima
   na potrebnim CRM tabelama; ne koristiti avnadmin kao runtime korisnika.
3. Provjeriti Aiven CA/hostname, uploadati javni CA prema potrebi.
4. Novi Hyperdrive na jsicrm, caching-disabled, VERIFY_IDENTITY.
5. Zamijeniti REPLACE_WITH_NEW_HYPERDRIVE_ID stvarnim novim ID-jem.
6. Postaviti MCP_SERVICE_TOKEN u Worker secret; ne prikazivati vrijednost.
7. Objaviti novi Worker i provjeriti /health i autentificirani read/stats.
8. Podesiti novi Manufact MCP: CRM_TRANSPORT, CRM_WORKER_BASE_URL,
   CRM_WORKER_SERVICE_TOKEN; objaviti provjerenu razvojnu verziju.
   Ako pristup Manufactu nedostaje, traziti samo taj preduslov.
9. Nakon potvrde citanja implementirati i testirati atomski upis,
   odobrenja, historiju, selektivni restore i R2 outbox.
10. Hetzner CRM direktni upisi zasad nece biti evidentirani.

## Ne predstavljati kao gotovo

Cloudflare/Hyperdrive nisu kreirani ni povezani. Worker nije objavljen.
Manufact MCP nije promijenjen online. Write/restore/R2 nisu implementirani.
Konfiguracija ima placeholder Hyperdrive ID, oba prekidaca su false.
Stari MCP i postojece CRM poslovne tabele nisu mijenjani u ovoj fazi.

## Cloudflare spoj provjeren 07.10.2026.
Worker: https://manufact-db-rollback.6f484zn9bd.workers.dev
Hyperdrive: manufact-jsicrm-fresh, 086fd3f6d396445eb3db0cb64f5ff9c7.
Baza: Aiven jsicrm; poseban korisnik sa SELECT pravima na odobrenim kolonama.
TLS VERIFY_IDENTITY sa Aiven CA; keširanje isključeno; maksimalno pet origin konekcija.
Hyperdrive binding koristi virtualni naziv: stvarni DATABASE() se provjerava nakon spajanja.
Live test: health 200, neautorizovani upit 401, autorizovani stats 200.
22 MCP i 6 Worker testova prolaze, MCP build i Worker typecheck prolaze.
MCP hosting prijava potvrđena; konfiguracija postojećeg servera se ažurira.
Historija, upis, restore i R2 proces još nisu implementirani; WRITES_ENABLED i RESTORES_ENABLED su false.

## MCP spoj potvrđen
07.10.2026. javni MCP crm_stats vratio je agregatne rezultate iz jsicrm preko Workera i Hyperdrivea.
MCP URL: https://keen-forge-ldf39.run.mcp-use.com/mcp
Aktivna objava: 3af02300-d76f-4e9b-9159-78539cfbd30a, commit c21598f.
Produkcijska grana: feature/cloudflare-read-gateway-20261007.
Sve osam dodatnih read ruta vraćaju 200 u probama bez prikaza pojedinačnih zapisa.
Postojeća grana feature/cloudflare-history s nacrtom historije nije prepisana.
Slobodni SQL je zatvoren (403); specijalizirane read rute rade.
Naredna faza je integracija nacrta historije, identiteta i odobrenja te kontrolisani test upisa/restorea i R2 arhive.
CRM izmjene s Hetznera još nemaju automatsko praćenje; za njih je potrebna posebna integracija.
