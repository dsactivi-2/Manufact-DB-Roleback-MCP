# Uebergabe CRM-MCP, 14. Oktober 2026

Adel hat den laufenden Stand geprueft. Suche, Profil, Statistik, Freigabeliste und der neue Build funktionieren. Diese Notiz ist der Punkt, an dem Denis weiterarbeiten kann. Sie beschreibt den deployten Stand, nicht die aelteren Statusdokumente.

Nachtrag vom 16. Oktober 2026: Telefonfilter, XML-Export und gespeicherte Filterketten liegen in diesem Branch. Der zuletzt deployte Produktionsstand vor diesem Push bleibt Commit 1dc8f4c und Deployment 893da7ea-5973-4204-a244-6a53789bfdbd. Ein Push dieses Branches deployed nur das Manufact-MCP, nicht den Worker. Commit dieser Aenderung ist 364d236.

## Wo der Stand liegt

- Branch: `feature/cloudflare-read-gateway-20261007`
- Commit: `1dc8f4c` — Align CRM search, approvals, and docs with the working server.
- Davor: `b56ea81` — jedes CRM-Lesen verlangt die Admin-Rolle. Der gemeinsame Token und jede Nicht-Admin-Rolle kommen nicht mehr an Kandidaten, Firmen, Auftraege oder das Schema.
- Manufact-Deployment `893da7ea-5973-4204-a244-6a53789bfdbd` laeuft als Produktion auf diesem Commit.
- MCP: https://keen-forge-ldf39.run.mcp-use.com/mcp
- Worker: https://manufact-db-rollback.6f484zn9bd.workers.dev
- Worker-Version nach dem heutigen Deploy: `29253b6d-4a13-47cf-b8c9-90649fc5a99a`
- Weg: ChatGPT/Codex, dann MCP, dann Cloudflare Worker, dann Hyperdrive `086fd3f6d396445eb3db0cb64f5ff9c7`, dann Aiven `jsicrm`.

Ein Git-Push auf diesen Branch startet das Manufact-Deployment. Der Worker wird davon nicht mit deployed. Worker-Aenderungen brauchen im Verzeichnis `cloudflare/worker` ein eigenes `npm run deploy`.

## Was heute an ist

Im deployten Worker:

- `WRITES_ENABLED=true`
- `RESTORES_ENABLED=true`
- `REQUIRE_APPROVAL=true`
- `ALLOW_TEST_ENTITIES=false`

Auf Manufact ist `CRM_MUTATION_TOOLS_ENABLED=true`. History, Preview, Apply, Restore und Approval sind deshalb als Werkzeuge registriert. `crm_query` ist nicht registriert. `/v1/read/query` bleibt mit `SQL_GATEWAY_DISABLED` geschlossen.

Die Staging-Wrangler-Konfiguration laesst Schreiben und Restore aus. Nur die Produktionskonfiguration ist an.

## Wer testen darf

WorkOS Staging, Organisation Activi (`org_01M48VN5QRCXCS4QENW7QS6DQT`), Client `client_01M48TZ5VD659BR6GD0M2ZYWE2`. Die WorkOS-Produktion hat keine Benutzer und keine CRM-Rollen. Nicht dort testen.

Beide Konten haben dieselben drei Rollen: Admin, CRM Writer Approval Required (`crm-writer-approval`) und CRM Approver (`crm-approver`). Nach der Rollenaenderung muss man sich ab- und wieder anmelden. Ein altes Token enthaelt die neuen Rollen nicht.

| Konto | WorkOS-Benutzer | Wofuer |
| --- | --- | --- |
| adel.hrnjic@idkstudio.com | `user_01M4BAAE7CTQ58MCJPPB6GX5G2` | Antrag stellen und die eigene, bereits genehmigte Aenderung anwenden |
| ds@activi.io | `user_01M48VNGK9AM047ND6SJPKBM56` | Den Antrag des anderen Kontos genehmigen oder ablehnen, und eigene Antraege stellen |

Der gemeinsame Bearer `CRM_MCP_SERVER_TOKEN` ist nur `crm:read` und kein Admin. Er kann weder lesen, was Admin verlangt, noch schreiben oder freigeben. Tests laufen mit dem persoenlichen WorkOS-Login, nicht mit diesem Token.

Lesen verlangt `crm:admin`. Schreiben und Freigabe verlangen zusaetzlich die passenden Entity-Scopes. Die kommen aus den Rollen-Slugs in `src/permissions.ts`, nicht nur aus den im WorkOS-Rollenobjekt gespeicherten Permission-Slugs. Deshalb funktionieren Kind-Entitaeten heute, obwohl die WorkOS-Rollenobjekte `request_write` und `approve_write` fuer Ausbildung, Sprache und Erfahrung noch nicht vollstaendig enthalten.

## Woran getestet wird

Kontrollsatz: Kandidat `198811`, Vorname aktuell `MCP-TEST`. Das ist der einzige Satz fuer Schreib-, Freigabe- und Restore-Tests.

Offen, Stand dieser Uebergabe:

- Approval `ede2f971-e6b0-415d-9d74-a1300f71bee1`
- Vorschau: Vorname `MCP-TEST` nach `MCP-TEST1`, Revision 2
- laeuft ab: 2026-10-15 13:12:35 UTC

Wenn Adel diesen Antrag gestellt hat, kann nur Denis ihn entscheiden. Adel wendet ihn danach selbst an. Elvis Hurtic, Kandidat 527, ist eine echte Person und bleibt nur zum Lesen.

Bereits in der History von 198811:

1. `d412d866-a178-4dba-8a13-67089fc00c1b`: `MCP-TEST` nach `MCP-TEST2`
2. `4130b3b1-19e4-40c0-b676-1b1677c07f4c`: Restore zurueck auf `MCP-TEST`

`synthetic_candidate` ist nur fuer isolierte Tests. In Produktion ist `ALLOW_TEST_ENTITIES=false`, dieser Typ ist dort gesperrt.

## So arbeiten die Skills

Installierter Skill: `crm-kandidatensuche`. Quelle im Repo: `skills/crm-kandidatensuche`. Die ausfuehrliche Schreibregel steht in `skills/crm-kandidatensuche/references/writes.md`.

Der Skill sucht, zaehlt und zeigt Profile. Eine Aenderung, History oder Freigabe macht er nur, wenn der Nutzer das ausdruecklich verlangt. `Mujo udri`, `muy útil` und `u tambure` starten hoechstens eine bereits genannte Leseabfrage. Sie erlauben nie einen Schreibvorgang.

- Eine Person wird mit `crm_search_kandidaten` und dem ganzen Namen gesucht. Kein Beruf, keine Sprache, kein Alter und kein EU-Filter, solange der Nutzer sie nicht nennt.
- Jedes Namenswort muss im Vor- oder Nachnamen vorkommen. Grossschreibung und Diakritika sind egal. `dj` trifft auch `d`. Das Geburtsdatum steht nicht in der Suchzeile.
- `crm_kandidat_profile` nur fuer eine schon bekannte `kandidat_id` oder wenn der Nutzer mehr als die Suchzeile will. Das Profil enthaelt Gruppe, Statuslabel, Sprachen, Erfahrungspositionen mit Datum und Ausbildung. Das Geburtsdatum wird nur wiederholt, wenn nach Datum, Alter oder dem Profil gefragt wurde.
- Eine Anzahl wie „wie viele Konobare“ ist `crm_search_kandidaten` mit `position_text` und `count_only: true`. Der Server setzt nur eine kurze Liste gleicher Berufe gleich, darunter konobar, Kellner, Kellnerin und waiter. Keine weiteren verwandten Berufe erfinden.
- `crm_beruf_report` ist der aggregierte Berufsreport, nicht der Ersatz fuer eine einfache Anzahl.
- `crm_resolve_beruf` listet Varianten und sucht nicht selbst.
- Status 3 ist Archiv und bleibt draussen, bis `archived=true`. Eine Seite hat hoechstens 50 Zeilen. `total_count` ist die volle Zahl.
- `FORBIDDEN`, `WRITES_DISABLED` und `SQL_GATEWAY_DISABLED` beenden diese Aktion. Nicht ueber eine andere Tabelle oder freies SQL erneut versuchen.

## Aendern, freigeben, anwenden

Vor der ersten Aenderung `crm_entity_policy_list` lesen und die API-Feldnamen daraus verwenden, nicht die Spaltennamen. Ein Patch hat 1 bis 20 Felder. `candidate_status` ist nur lesbar. Delete und Drop gibt es nicht.

Entitaeten mit Update und Restore: `candidate`, `company`, `order`, `candidate_group`. Zusaetzlich einfuegen duerfen: `candidate_education`, `candidate_language`, `candidate_experience`. Ein Insert nutzt `operation: "insert"`, `entity_id: "new"` und `expected_revision: "0"`.

Ablauf, immer in dieser Reihenfolge:

1. `crm_change_preview` mit `entity_type`, `entity_id`, `expected_revision`, `patch`, `reason` (3 bis 500 Zeichen) und `idempotency_key` (8 bis 128 Zeichen aus `A-Za-z0-9._:-`). Die Vorschau speichert die Fachzeile nicht. Dem Nutzer Vorher und Nachher zeigen.
2. Erst nach Bestaetigung des Nutzers die unveraenderte Vorschau an `crm_write_request_approval` geben. Der Antrag bleibt 24 Stunden offen und gehoert dem antragstellenden Principal.
3. Das andere Konto liest `crm_write_approval_list` fuer genau einen `entity_type` und entscheidet mit `crm_write_decide`. Felder: `approval_id` und `decision` mit `approved` oder `rejected`. Der Antragsteller bekommt `FORBIDDEN`: „Der Antragsteller darf die eigene Freigabe nicht entscheiden.“ `FORBIDDEN` heisst nicht, dass die Liste leer ist.
4. Nach der Genehmigung hat dasselbe Antragstellerkonto 15 Minuten. `crm_change_apply` wiederholt dieselbe Nutzlast plus `approval_id`. Die Freigabe ist einmalig, muss zum Preview-Hash passen und demselben Principal gehoeren. Ein anderer Benutzer bekommt „Freigabe gehoert zu einem anderen Benutzer.“
5. Derselbe Idempotenzschluessel holt nur dasselbe Ergebnis nach. Ein neuer Schluessel ist eine neue Aenderung.

Ohne `WRITES_ENABLED` liefern Antrag, Entscheidung und Apply `WRITES_DISABLED`. Die Vorschau bleibt moeglich.

## History und Restore

`crm_history_list` zeigt bis zu 50 Ereignisse fuer genau einen Typ und eine Id. Lesen, Beantragen oder Freigeben fuer diese Entitaet reicht dafuer.

Restore stellt nur die vom Nutzer genannten Felder wieder her. `crm_restore_preview` braucht `source_event_id`, diese Feldnamen, einen Grund und einen neuen Idempotenzschluessel. Danach derselbe Weg: Approval durch das andere Konto, dann `crm_restore_apply` durch den Antragsteller. Ein Restore ist ein neues History-Ereignis. Er loescht das spaetere Ereignis nicht. Ein Insert-Ereignis kann nicht restored werden, weil es kein Delete gibt. `RESTORES_ENABLED` gilt nur zusammen mit aktivem Schreiben.

## Was deutsch geblieben ist

Absichtlich deutsch, weil das die Sprache der Werkzeuge und Fehler fuer das Modell ist:

- Titel und Beschreibungen der MCP-Werkzeuge in `index.ts`
- Fehlertexte in `src/history.ts`, `src/registry.ts`, `src/sql.ts`, `src/guard.ts` und `src/auth.ts`
- die aelteren Fachstaende `docs/Status_2026-10-13.md`, `docs/Arbeitsstand.md` und `docs/Projektstatus_DE.md`. Darueber steht nur ein kurzer Hinweis vom 14. Oktober. Die alten Absaetze nicht umschreiben.

Englisch sind der Skill, `references/writes.md`, die Suchregeln und der groesste Teil der README. `RUNBOOK.md` ist auf B/H/S. Ein Satz darin ist veraltet: der Testabschnitt vom 13. Oktober sagt, es habe keinen Produktions-Deploy und keinen Produktions-Write gegeben. Das galt vor dem heutigen Deploy von Commit `1dc8f4c` und der Worker-Version `29253b6d`.

## Was noch offen ist

- `config/activation-plan.local.json` existiert nicht. `npm run preflight:activation` bleibt deshalb rot. Das ist so gewollt, bis die fachlichen Entscheide eingetragen sind. `npm run preflight` ohne `--activation` ist der gruene Repository-Check.
- Die numerischen Statuswerte fuer Firmen und Auftraege haben keine gepruefte Werteliste. Nicht raten.
- Die WorkOS-Permission-Objekte der Rollen `crm-writer-approval` und `crm-approver` enthalten die Kind-Entitaeten Ausbildung, Sprache und Erfahrung nicht vollstaendig. Der Server gleicht das heute ueber den Rollen-Slug aus. Wer spaeter nur das JWT-Permission-Array vertraut, muss diese Slugs in WorkOS nachziehen.
- Die WorkOS-Produktion hat keine Benutzer. Neue echte Logins gehoeren nach Staging, Organisation Activi, solange der MCP auf diesen Client zeigt.
- Der naechste fachliche Test ist der offene Antrag auf Kandidat 198811: Denis entscheidet, Adel wendet an, danach History pruefen. Echte Kandidaten dafuer nicht benutzen.
- Der Antrag ede2f971-e6b0-415d-9d74-a1300f71bee1 lief am 15. Oktober 2026 13:12:35 UTC ab. Vor einem neuen Schreibtest eine neue Vorschau stellen.
- Telefonfilter und koraci fuer Filterketten laufen im Worker. Ohne neues Worker-Deploy lehnt der alte Worker diese Felder ab. Git-Push allein reicht dafuer nicht. Deploy aus cloudflare/worker mit npm run deploy.
- Der Gateway-Benutzer hat noch kein SELECT auf idk_kandidati.kandidat_mobitel. scripts/provision-db.mjs enthaelt die Spalte fuer das naechste Provisioning, der Grant wurde am 16. Oktober nicht ausgefuehrt. Bis dahin schlaegt jede Telefonabfrage mit fehlender Spaltenrechte fehl. Normale Suche ohne Telefon bleibt davon unberuehrt, weil die Spalte nur bei Telefonfilter oder ukljuci_telefon im SELECT steht.
- Outbox-Kontrolle nach dem ersten genehmigten Ereignis: Cron `*/5 * * * *` soll den Status nach `archived` setzen und `events/<event_id>.json` in den Bucket `manufact-db-rollback-audit` schreiben.
- Delete, Drop, Scoring, Fotos und Biometrie sind keine Werkzeuge und sollen keine werden, solange das nicht ausdruecklich entschieden ist.

Rollback, falls ein Test schiefgeht: zuerst `RESTORES_ENABLED=false`, dann `WRITES_ENABLED=false`, dann `CRM_MUTATION_TOOLS_ENABLED=false`. Outbox-Zeilen bleiben in MySQL.

## Nachtrag 16. Oktober 2026

Geprueft am 16. Oktober lokal, nicht gegen die laufende Produktion. npm test: 44 Tests gruen. Davon fuer die neuen Teile: test/sql.test.ts fuer Telefon und Filterkette, test/xml-export.test.ts mit 3 Tests, test/filter-cache.test.ts mit 1 Test. npm run build schreibt .mcp-use/build/index.js. npm --prefix cloudflare/worker run typecheck ist gruen. MySQL-Integration und ein Live-Anruf gegen Aiven wurden fuer diese Aenderung nicht gefahren.

### Telefon

crm_search_kandidaten hat das optionale Feld telefon. Gesucht wird in idk_kandidati.kandidat_mobitel. Verglichen werden nur Ziffern, 6 bis 15 Stueck. 061 123 456, +38761123456 und 0038761123456 treffen dieselbe Nummer. Die Nummer steht nur in den Zeilen dieser Telefonsuche. Eine Namenssuche gibt sie nicht aus. E-Mail, Adresse und Geburtsdatum bleiben draussen.

### XML-Export

Neues Werkzeug crm_export_kandidaten_xml. Dieselben Filter wie die Kandidatensuche, Admin-Rolle, hoechstens 1000 Zeilen. truncated und next_cursor setzen denselben Filter fort. Standardfelder: Id, Vorname, Nachname, Status, abgeleitetes Alter. ukljuci_telefon true oder ein gesetzter telefon-Filter nimmt kandidat_mobitel als telefon-Element auf. Sonst nicht.

### Mini-Mengen

Ein Filter ohne Cursor speichert eine Filterkette im MCP-Prozess und liefert cache_id, fc_ plus 16 Hex-Zeichen, und optional naziv. Der naechste Aufruf von Suche oder Export mit dieser cache_id und einem neuen Filter sucht nur innerhalb dieser Kette und speichert die engere Kette als neues cache_id. Nur cache_id, ohne neuen Filter, bleibt bei derselben Menge. Eine spaetere archived true erweitert eine bereits ausgeschlossene Archivmenge nicht. Widerspruch bei eu_buerger trifft nichts. Alter wird als Schnitt der Grenzen angewandt. Hoechstens 12 Schritte und 100 Mengen. Restart loescht sie. Das ist keine zweite Datenbank und keine Kopie der Zeilen. Die Kette wird beim naechsten Lesen neu gegen das CRM gerechnet.

crm_filter_cache_lista zeigt die Mengen. crm_filter_cache_obrisi loescht eine. Schon erzeugte engere Mengen behalten ihre eigene Kette.

Der Worker sieht das als Feld koraci auf /v1/read/candidates. Der alte Worker kennt das Feld nicht. Deshalb gehoert zum Push ein Worker-Deploy, sonst antwortet die Produktionskette mit einem Validierungsfehler.

