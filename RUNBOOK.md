# Runbook: noch einzurichten

Stand: 7. Oktober 2026, erneut gelesen. Repo: https://github.com/dsactivi-2/Manufact-DB-Roleback-MCP. Lokale Kopie: `/Users/activi/Documents/ChatGPT/Manufact-DB-Roleback-MCP`. Öffentliche MCP-Adresse: https://keen-forge-ldf39.run.mcp-use.com/mcp. Laufendes Deployment: `ff81c9cd-472b-4800-9ce8-d45c9b49b960`, Branch `main`, Commit `8b9440d9de5ead5c93f950b1a1b84c90c9a30078`, Status `running`. `82ea4657-f2b8-484f-b2e3-c731304eb8dc` ist gestoppt. Die Cloudflare-Umsetzung liegt lokal auf `feature/cloudflare-history` und ist nicht deployed. Der detaillierte Stand steht in [docs/Arbeitsstand.md](docs/Arbeitsstand.md). Die alte Adresse https://calm-forge-hk9rc.run.mcp-use.com/mcp gehört zu `cloud-crm-mcp` und wird hier nicht verändert.

Änderungen an Manufact-Variablen gelten erst nach einem neuen Deployment.

## Bereits vorhanden

- Der Server läuft und die Adresse oben ist die Manufact-Adresse.
- `MCP_URL` und `OAUTH_RESOURCE` sind auf https://keen-forge-ldf39.run.mcp-use.com/mcp gesetzt.
- `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` ist `balanced-lantern-65-staging.authkit.app`.
- `CRM_MCP_SERVER_TOKEN` ist vorhanden. Der Wert wurde nicht ausgelesen.
- `CSP_URLS` hat keinen änderbaren Variablen-Eintrag. Der Wert wurde nicht ausgelesen.
- `CRM_DATABASE_URL` fehlt.

## Manufact-Variablen

| Variable | Status | Was eingesetzt werden muss |
|---|---|---|
| `CRM_MCP_SERVER_TOKEN` | Name vorhanden, Wert ungeprüft | Neuer Bearer-Token nur für diesen Server. Nicht den Token von `cloud-crm-mcp` wiederverwenden. Nicht ins Repo schreiben. |
| `MCP_URL` | gesetzt | `https://keen-forge-ldf39.run.mcp-use.com/mcp` |
| `CSP_URLS` | Name vorhanden, Wert ungeprüft | Dieser Source liest `CSP_URLS` nicht. Falls der Wert `calm-forge-hk9rc` enthält, durch `keen-forge-ldf39` ersetzen. |
| `OAUTH_RESOURCE` | gesetzt | `https://keen-forge-ldf39.run.mcp-use.com/mcp` |
| `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` | gesetzt | `balanced-lantern-65-staging.authkit.app` |
| `CRM_DATABASE_URL` | fehlt, so lassen bis ein getrenntes Testziel existiert | Nur ein neues Testschema, nie `defaultdb` und nie die Hosts `activi-dsactivi-d23a.b.aivencloud.com` oder `mysql-d7a5876-dsactivi-d23a.l.aivencloud.com`. In der Zielarchitektur liest der MCP diese URL nicht mehr; sie bleibt der direkte Lesepfad, solange `CRM_TRANSPORT` nicht `cloudflare` ist. |
| `CRM_TRANSPORT` | fehlt | Erst `cloudflare` setzen, wenn Worker-URL, Token und Identität geprüft sind. Vorher bleiben die 11 Lesetools auf dem direkten MySQL-Pfad. |
| `CRM_WORKER_BASE_URL` | fehlt | HTTPS-Basis des neuen Workers, ohne abschließenden Schrägstrich. Noch nicht vorhanden. |
| `CRM_WORKER_SERVICE_TOKEN` | fehlt | Gemeinsames Geheimnis mit der Worker-Variable `MCP_SERVICE_TOKEN`. Nicht ins Repo. |
| `CRM_IDENTITY_ASSERTION_PRIVATE_KEY` | fehlt | Privater Ed25519-Schlüssel, PKCS8 PEM. Der Worker erhält nur den öffentlichen Schlüssel als `IDENTITY_ASSERTION_PUBLIC_KEY`. |

Nicht setzen: `OAUTH_CLIENT_SECRET`. Der Server verwendet es nicht. `CRM_HYPERDRIVE_ID`, `HYPERDRIVE_CONFIG_ID` und `DATABASE_URL` sind keine Manufact-Anschlusswerte. Sie dürfen die Marker `00184318f6854e1788f6061e24eaf24f`, `71d03de751b74a5ca1f71dd382328c2b`, `crm-pipedrive-worker` und die beiden genannten Aiven-Hosts nicht enthalten, sonst stoppt der Start.

## WorkOS

WorkOS ist auf diesem Deployment aus. Ohne diese Variablen bleibt die Anmeldung der gemeinsame Bearer-Token.

1. In WorkOS die bestehende oder neue AuthKit-App so einrichten, dass die Ressource `https://keen-forge-ldf39.run.mcp-use.com/mcp` zulässig ist. Das WorkOS-Dashboard wurde hier nicht geprüft.
2. `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` auf die AuthKit-Adresse setzen.
3. `OAUTH_RESOURCE` auf die neue MCP-Adresse setzen. `MCP_URL` ist nur der Ersatz, wenn `OAUTH_RESOURCE` leer ist.
4. `OAUTH_AUDIENCE` nur setzen, wenn WorkOS eine eigene Audience verlangt. Sonst leer lassen.
5. Nicht den Weg über einzelne Endpunkte mischen, außer WorkOS wird nicht verwendet. Dann sind `OAUTH_ISSUER`, `OAUTH_AUTHORIZATION_ENDPOINT`, `OAUTH_TOKEN_ENDPOINT`, `OAUTH_JWKS_URL` und `OAUTH_RESOURCE` oder `MCP_URL` gemeinsam nötig. Fehlt eines, startet der Server mit einer Fehlermeldung.
6. Danach neu deployen. Der laufende Build übernimmt die Variablen nicht.

Der gemeinsame Token bleibt danach als Ersatz gültig. In WorkOS-Modus prüft kein Toolhandler die WorkOS-Rolle. Nur `crm_query` verlangt den Scope `sql:read`.

## Datenbank

Solange `CRM_DATABASE_URL` fehlt, starten die anderen Teile, aber jede CRM-Abfrage antwortet mit `CRM_DATABASE_URL fehlt`.

- Eigener MySQL-Anschluss, nicht der alte Worker und nicht das alte Hyperdrive.
- Protokoll `mysql:`, Port sonst 3306.
- Der Source vertraut fest dem Aiven-Projektzertifikat in `src/aiven-ca.ts`. Eine andere Zertifizierungsstelle verlangt eine Änderung in `src/db.ts`. Ob die neue Datenbank zu diesem Zertifikat passt, ist offen.
- Nach dem Eintragen neu deployen.

## Partner und Secrets

Ein Partner-Anschluss, eine Partner-Adresse oder eine Partner-Variable kommt im Source nicht vor. Pipedrive ist nur als verbotener Altmarker vorhanden. Es gibt dafür nichts auf die neue MCP umzustellen.

Secrets bleiben in Manufact. Nicht committen: Token, Datenbankpasswort, WorkOS-Geheimnis, `.env`.

## Source

Geprüft am 7. Oktober 2026. Der Server liest die öffentliche Adresse nicht aus dem Code, sondern aus `OAUTH_RESOURCE` oder `MCP_URL`. `localhost` in README und Tests ist nur lokal beziehungsweise ein Beispiel.

| Stelle | Befund | Anpassung |
|---|---|---|
| `index.ts` | Servername bleibt `cloud-crm-mcp`. Keine öffentliche URL. | Keine Adressänderung. Umbenennen wäre eine eigene Entscheidung. |
| `src/auth.ts` | Liest WorkOS und OAuth nur aus der Umgebung. | Keine hart codierte neue URL einsetzen. |
| `src/db.ts`, `src/aiven-ca.ts` | MySQL nur über `CRM_DATABASE_URL`, Zertifikat fest eingebaut. | Nur ändern, wenn die Datenbank nicht zu diesem Aiven-Zertifikat gehört. |
| `src/guard.ts` | Blockiert die alten Marker. | Nicht entfernen. |
| `src/worker-client.ts`, `src/worker/` | Lesen geht nur bei `CRM_TRANSPORT=cloudflare` über typisierte `/v1/read`-Routen. Schreiben, History und Restore gehen ausschließlich dorthin. | Nicht auf `main` deployen, bevor Worker und Testziel stehen. |
| `src/registry.ts` | `candidate` / `idk_kandidati` hat keine Schreibfelder. Nur `synthetic_candidate` ist für das Testschema beschreibbar. | Keine echten Spalten eintragen, bevor das Schema gelesen wurde. |
| `sql/migrations/` | History-Tabellen und die synthetische Testtabelle. | Nicht gegen Aiven ausgeführt. `002` nie auf `defaultdb`. |
| `cloudflare/worker/wrangler*.jsonc` | Staging-Variablen, Writes und Restores aus. Kein Hyperdrive und kein R2, weil die IDs fehlen. | Keine Platzhalter-IDs einsetzen. |
| `skills/crm-kandidatensuche/agents/openai.yaml` | Verwies auf keinen öffentlichen URL. | Auf die neue MCP-Adresse nachgezogen. Der Toolname bleibt `cloud-crm-mcp`. |
| `test/auth.test.ts` | Beispiel `balanced-lantern-65-staging.authkit.app` und `crm.example.com`. | Testbeispiel, nicht die Produktionsadresse. Nicht durch die echte Subdomain ersetzen. |
| `package.json` | `homepage` zeigt auf das mcp-use-Upstream-Repo. | Kein Laufzeitanschluss. |

## Anschluss der Clients

ChatGPT, Codex und andere MCP-Clients müssen die neue Adresse verwenden. Der alte Server `cloud-crm-mcp` bleibt sonst getrennt erreichbar. Dieser Schritt liegt außerhalb des Repos und ist offen.


## Unterschied zum alten Server

Der alte Manufact-Server `cloud-crm-mcp` hängt an `dsactivi-2/Naufact-kopie-710-0232`, nicht an diesem Repo. Der Anwendungs-Source ist bis auf die hier geänderten Unterlagen gleich. Diese Servereinstellungen sind dort gesetzt und hier nicht. Sie waren im ersten Runbook nicht aufgeführt.
Der Vergleich gilt für das laufende Deployment auf `main`. `feature/cloudflare-history` ist davon bereits abgewichen und nicht veröffentlicht.

| Einstellung | Alter Server | Dieser Server | Folge |
|---|---|---|---|
| Analytics `capturePayloads` | ein | ein | übernommen |
| Feedback-Tool | ein | ein | übernommen |
| Checklisten-Automatik | `production` | `production` | übernommen |
| IP-Allowlist | vorhanden, aus, Presets ChatGPT und Manufact an, Anthropic aus | gleich gesetzt | übernommen, Allowlist bleibt aus |
| Build und Start | nur Port `3000` gespeichert | `npm run build`, `npm start`, Port `3000` | Entspricht `package.json`. |
| Variablen | Token, `MCP_URL`, `CSP_URLS`, `CRM_DATABASE_URL`, WorkOS-Subdomain, `OAUTH_RESOURCE` | Token, `MCP_URL`, `CSP_URLS`, WorkOS-Subdomain, `OAUTH_RESOURCE` | `CRM_DATABASE_URL` fehlt hier |

Diese vier Einstellungen werden nicht automatisch vom alten Server kopiert. Analytics, Feedback, Checkliste und IP-Allowlist sind jetzt gesetzt.

## Cloudflare, noch nicht angelegt

Gelesen am 7. Oktober 2026, Konto `2f8c7ae79d6d316eac3961585f5c2f5b`. Es gibt keinen Rollback-Worker und keinen Audit-Bucket für dieses Projekt. Vorhanden und verboten sind Hyperdrive `crm-mysql` (`71d03de751b74a5ca1f71dd382328c2b`, Cache an, `defaultdb`) und `jsimcp` (`00184318f6854e1788f6061e24eaf24f`, Cache an, `defaultdb`). Die R2-Buckets `activi-backups`, `ecommerce-data`, `macm3` und `realtine` gehören nicht hierher.

Erst nach einem eigenen Testschema, das nicht `defaultdb` ist:

1. Neues Hyperdrive ohne Cache und mit TLS auf dieses Testschema. Die ID in `cloudflare/worker/wrangler.staging.jsonc` als Binding `HYPERDRIVE_FRESH` eintragen.
2. Neuen R2-Bucket nur für das Audit-Archiv anlegen und als `AUDIT_ARCHIVE` binden.
3. Worker-Variablen setzen: `MCP_SERVICE_TOKEN`, `IDENTITY_ASSERTION_PUBLIC_KEY`. `WRITES_ENABLED` und `RESTORES_ENABLED` bleiben `false`, bis die Abnahme das ändert. `ALLOW_TEST_ENTITIES` nur für das synthetische Schema.
4. Dieselben Namen auf Manufact setzen: `CRM_TRANSPORT=cloudflare`, `CRM_WORKER_BASE_URL`, `CRM_WORKER_SERVICE_TOKEN`, `CRM_IDENTITY_ASSERTION_PRIVATE_KEY`.
5. `wrangler deploy --dry-run` ist am 7. Oktober 2026 mit Wrangler 4.100.0 ohne Bindings durchgelaufen. Ein echtes Staging-Deploy braucht eine gesonderte Freigabe und darf nicht nach `main` gehen. `main` deployt auf Manufact automatisch.

## Abnahme, noch offen

- Getrenntes Aiven-Testschema und dessen Grants bereitstellen. `CRM_DATABASE_URL` nicht mit einem bekannten Produktivhost füllen.
- Cachefreies Hyperdrive, Audit-R2 und die Worker-Geheimnisse anlegen.
- Feature-Branch nur nach Freigabe als Staging deployen. `main` und das Original `9e075f18-34d7-4a71-a3e9-88868821addb` nicht anfassen.
- Echtes Feldmapping für `idk_kandidati` erst nach gelesenem Schema. Bis dahin bleibt `candidate` gesperrt.
- Freigabeoberfläche fehlt. `crm_change_apply` kann eine Freigabe nicht selbst erzeugen.
- INV-Fälle 09–12 und 23–26 sind gegen Staging nicht gelaufen.
- `CRM_MCP_SERVER_TOKEN` bleibt ungeprüft und gehört nicht ins Repo.
- `CSP_URLS` konnte nicht geändert werden, weil kein Variablen-Eintrag vorhanden ist.
- Clients, die noch https://calm-forge-hk9rc.run.mcp-use.com/mcp verwenden, auf https://keen-forge-ldf39.run.mcp-use.com/mcp umstellen.
