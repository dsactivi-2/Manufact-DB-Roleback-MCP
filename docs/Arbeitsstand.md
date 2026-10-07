# Arbeitsstand

Stand: 7. Oktober 2026. Branch: `feature/cloudflare-history`, Ausgang `main` `8b9440d9de5ead5c93f950b1a1b84c90c9a30078`. Der Commit, der diese Datei enthält, ist der lokale Implementierungsstand. Nicht gepusht.

Umgebung: Manufact-Server `Manufact-DB-Roleback-MCP`, ID `77a6298d-34e9-4d70-9454-d47c8d300361`, URL https://keen-forge-ldf39.run.mcp-use.com/mcp. Laufendes Deployment `ff81c9cd-472b-4800-9ce8-d45c9b49b960`, Branch `main`, Commit `8b9440d`, Status `running`. Worker und R2 für dieses Projekt existieren nicht. Cloudflare-Konto `2f8c7ae79d6d316eac3961585f5c2f5b`.

Aktuelles Paket: P3/P4 lokal gegen synthetische Daten abgeschlossen. P2 ist als Code und Dry-Run vorhanden, nicht deployed. P5 ist nur gegen ein Speicher-Archiv im Test gelaufen.

## Verifizierte Fakten

- Das Original `cloud-crm-mcp` (`9e075f18-34d7-4a71-a3e9-88868821addb`, https://calm-forge-hk9rc.run.mcp-use.com/mcp) wurde in diesem Arbeitsgang nicht gelesen und nicht verändert.
- Hyperdrive `crm-mysql` und `jsimcp` zeigen beide auf `defaultdb`, Cache ist an. Beide bleiben verboten. Es wurde kein neues Hyperdrive angelegt.
- R2 enthält nur `activi-backups`, `ecommerce-data`, `macm3` und `realtine`. Keiner davon ist das Audit-Archiv.
- Am neuen Server gesetzt, ohne Werte zu lesen: `CRM_MCP_SERVER_TOKEN`, `MCP_URL`, `MCP_USE_OAUTH_WORKOS_SUBDOMAIN`, `OAUTH_RESOURCE`, `CSP_URLS`. `CRM_DATABASE_URL` und die Worker-Variablen fehlen.
- `main` deployt automatisch. `deployBranchPatterns` ist leer, deshalb deployt der Feature-Branch nicht von selbst.
- Das Schema von `idk_kandidati` wurde nicht gelesen. Schreibfelder dafür bleiben leer.

## Änderungen abgeschlossen

- Lesen kann bei `CRM_TRANSPORT=cloudflare` über `src/worker-client.ts` und `/v1/read/...` laufen. Ohne diese Variable bleibt der bisherige direkte MySQL-Lesepfad.
- `crm_change_preview`, `crm_change_apply`, `crm_restore_preview`, `crm_restore_apply` und `crm_history_list` gehen immer über den Worker. Apply kann keine Freigabe setzen. Der gemeinsame Token hat kein `crm:write`.
- History, Idempotenz, Revisionen, Baseline und Outbox liegen in einer MySQL-Transaktion. Ein Historienschaden rollt den Geschäftswrite zurück. Physisches DELETE ist abgelehnt.
- Ein Archivfehler gibt den Outbox-Lease frei. Das Ereignis bleibt `pending` und kann erneut archiviert werden. R2 wird erst nach dem Commit beschrieben.
- Einziges beschreibbares Entity ist `synthetic_candidate` in `rb_synth_candidate`. `candidate` ist ungeprüft und gesperrt.
- Wrangler-Einstieg ist `src/worker/index.ts`. Die Wrangler-Dateien enthalten bewusst kein Hyperdrive und kein R2.

## Tests mit Ergebnis

- `npm test`: 19 bestanden, darunter die bisherigen Lesetests und die Architekturtests.
- `npm run typecheck`: keine Fehler.
- `npm run build`: `index.ts` nach `.mcp-use/build/index.js` gebaut. Der Ordner ist ignoriert.
- `npm run test:mysql` gegen lokales MySQL 8.4 im Container `rb-mysql-test`, Datenbank `rollback_test`, nicht Aiven: beide Tests bestanden. Geprüft wurden Atomizität, Replay, Idempotenzkonflikt, Historienschaden, Antwortverlust, selektives Restore, Feldkonflikt, DECIMAL/NULL/BIGINT, Outbox-Wiederholung und zwei konkurrierende Verbindungen.
- `wrangler deploy --dry-run` mit Wrangler 4.100.0 und `cloudflare/worker/wrangler.jsonc`: Exit 0, nur die Staging-Variablen, keine Datenbindung. Nicht deployed.

## Noch nicht geprüft

- Verbindung zu Aiven, echte Tabellentypen und Grants.
- Staging-Worker, cachefreies Hyperdrive, R2-Prüfsummen und Manufact-Variablen für den Worker.
- INV 09–12 und 23–26, Last und Backupübung.
- Ob `CSP_URLS` die alte Adresse enthält. Der Wert wurde nicht gelesen, und der Eintrag hat keine änderbare ID.

## Blockaden

Es fehlt ein getrenntes Testschema, das nicht `defaultdb` ist und keinen der gesperrten Hosts verwendet. Ohne dieses Schema werden keine echten Feldmappings, kein Hyperdrive und kein Staging-Deploy angelegt. Die Freigabeoberfläche ist nicht Teil des Workers; ein Operator muss `rb_approvals` außerhalb des MCP schreiben.

## Exakt nächster Schritt

Ein eigenes Aiven-Testschema bereitstellen und seine Schlüssel und Spaltentypen lesen. Danach erst Hyperdrive ohne Cache, Audit-Bucket und die vier Manufact-Variablen `CRM_TRANSPORT`, `CRM_WORKER_BASE_URL`, `CRM_WORKER_SERVICE_TOKEN` und `CRM_IDENTITY_ASSERTION_PRIVATE_KEY` eintragen. Writes bleiben aus.

Original unverändert: in diesem Arbeitsgang keine Mutation am Originalserver ausgeführt.
