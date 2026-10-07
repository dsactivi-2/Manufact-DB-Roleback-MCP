# Runbook: noch einzurichten

Stand: 7. Oktober 2026. Repo: https://github.com/dsactivi-2/Manufact-DB-Roleback-MCP. Lokale Kopie: `/Users/activi/Documents/ChatGPT/Manufact-DB-Roleback-MCP`. Öffentliche MCP-Adresse: https://keen-forge-ldf39.run.mcp-use.com/mcp. Laufendes Deployment: `cbbcab9c-581e-448e-9913-1b3c2c348232`, Branch `main`, Status `running`. Die alte Adresse https://calm-forge-hk9rc.run.mcp-use.com/mcp gehört zu `cloud-crm-mcp` und wird hier nicht verwendet.

Änderungen an Manufact-Variablen gelten erst nach einem neuen Deployment.

## Bereits vorhanden

- Der Server läuft und die Adresse oben ist die Manufact-Adresse.
- Gespeicherte Variablennamen: `CRM_MCP_SERVER_TOKEN`, `MCP_URL`, `CSP_URLS`. Die Werte wurden nicht ausgelesen. Ob `MCP_URL` und `CSP_URLS` schon die neue Adresse enthalten, ist deshalb offen.
- `CRM_DATABASE_URL`, `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` und `OAUTH_RESOURCE` sind auf diesem Server nicht gespeichert.

## Manufact-Variablen

| Variable | Status | Was eingesetzt werden muss |
|---|---|---|
| `CRM_MCP_SERVER_TOKEN` | Name vorhanden, Wert ungeprüft | Neuer Bearer-Token nur für diesen Server. Nicht den Token von `cloud-crm-mcp` wiederverwenden. Nicht ins Repo schreiben. |
| `MCP_URL` | Name vorhanden, Wert ungeprüft | `https://keen-forge-ldf39.run.mcp-use.com/mcp`, falls der gespeicherte Wert noch auf die alte Adresse zeigt. |
| `CSP_URLS` | Name vorhanden, Wert ungeprüft | Dieser Source liest `CSP_URLS` nicht. Falls der Wert `calm-forge-hk9rc` enthält, durch `keen-forge-ldf39` ersetzen. |
| `OAUTH_RESOURCE` | fehlt | Für WorkOS verpflichtend, wenn `MCP_URL` nicht dieselbe neue Adresse enthält: `https://keen-forge-ldf39.run.mcp-use.com/mcp`. Der Pfad muss `/mcp` sein. |
| `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` | fehlt | Nur die AuthKit-Adresse, zum Beispiel `name.authkit.app`. HTTPS, keine Pfadangabe, Host muss auf `.authkit.app` enden. |
| `CRM_DATABASE_URL` | fehlt | `mysql://BENUTZER:PASSWORT@HOST:PORT/DATENBANK`. Host, Datenbank, Benutzer und Passwort sind Pflicht. |

Nicht setzen: `OAUTH_CLIENT_SECRET`. Der Server verwendet es nicht. `CRM_HYPERDRIVE_ID` und `DATABASE_URL` werden nicht als Anschluss gelesen. Sie dürfen die Marker `00184318f6854e1788f6061e24eaf24f` und `crm-pipedrive-worker` nicht enthalten, sonst stoppt der Start.

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
| `skills/crm-kandidatensuche/agents/openai.yaml` | Verwies auf keinen öffentlichen URL. | Auf die neue MCP-Adresse nachgezogen. Der Toolname bleibt `cloud-crm-mcp`. |
| `test/auth.test.ts` | Beispiel `balanced-lantern-65-staging.authkit.app` und `crm.example.com`. | Testbeispiel, nicht die Produktionsadresse. Nicht durch die echte Subdomain ersetzen. |
| `package.json` | `homepage` zeigt auf das mcp-use-Upstream-Repo. | Kein Laufzeitanschluss. |

## Anschluss der Clients

ChatGPT, Codex und andere MCP-Clients müssen die neue Adresse verwenden. Der alte Server `cloud-crm-mcp` bleibt sonst getrennt erreichbar. Dieser Schritt liegt außerhalb des Repos und ist offen.

## Abnahme, noch offen

- Werte von `MCP_URL` und `CSP_URLS` prüfen und bei Bedarf auf die neue Adresse setzen.
- Neuen `CRM_MCP_SERVER_TOKEN` bestätigen.
- `CRM_DATABASE_URL` setzen, Zertifikat klären, neu deployen.
- WorkOS-Subdomain und `OAUTH_RESOURCE` setzen, neu deployen, Anmeldung prüfen.
- Clients auf https://keen-forge-ldf39.run.mcp-use.com/mcp umstellen.
