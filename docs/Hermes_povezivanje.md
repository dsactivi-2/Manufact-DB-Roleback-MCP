# CRM-MCP mit Hermes verbinden und testen

Es gibt einen MCP: `https://keen-forge-ldf39.run.mcp-use.com/mcp`.

Lesen und Schreiben laufen über Cloudflare: Hermes, dann MCP, dann Worker, dann Hyperdrive, dann Aiven. Es gibt keinen zweiten MCP fürs Schreiben.

Das Plugin `manufact-crm` bringt einen Skill mit, `crm-kandidatensuche`. Das ist die Arbeitsanweisung. Die einzelnen Abfragen sind Werkzeuge desselben MCP, keine weiteren Skills.

## Wer sich anmelden darf

Nur diese beiden E-Mails, beide in der WorkOS-Staging-Organisation Activi:

- `adel.hrnjic@idkstudio.com`
- `ds@activi.io`

Beide haben Admin, `crm-writer-approval` und `crm-approver`. Eine andere E-Mail kann sich nicht anmelden. Die WorkOS-Produktion hat keine Benutzer.

Der gemeinsame `CRM_MCP_SERVER_TOKEN` ist diese Anmeldung nicht. Er hat kein Admin-Recht, deshalb schlägt das Lesen damit fehl. Die MySQL-Adresse und `CRM_WORKER_SERVICE_TOKEN` gehören nicht in Hermes.

## Schritte

1. Das Plugin bleibt eingeschaltet. Falls der Skill nicht geladen ist, auf dem Rechner mit Hermes:

```text
hermes plugins install dsactivi-2/Manufact-DB-Roleback-MCP/hermes-plugin --ref c65244c3454335cfb2c48e154d02d8004c86f88d --enable
```

2. `~/.hermes/config.yaml` öffnen. Unter Windows liegt die Datei in `C:\\Users\\<Name>\\.hermes\\config.yaml`. Wenn `mcp_servers` schon existiert, nur `crm` darin ergänzen. Andere Server nicht löschen.

```yaml
mcp_servers:
  crm:
    url: "https://keen-forge-ldf39.run.mcp-use.com/mcp"
    auth: oauth
```

Dieser Eintrag ersetzt den festen Bearer aus dem Plugin. Hermes verlangt danach kein `CRM_MCP_SERVER_TOKEN` mehr in der `.env`.

3. Anmelden:

```text
hermes mcp login crm
```

Hermes zeigt einen Link. Den im Browser öffnen. Die Seite ist WorkOS, `balanced-lantern-65-staging.authkit.app`. Mit einer der beiden E-Mails oben anmelden. Warten, bis Hermes meldet, dass die Anmeldung geklappt hat.

4. Eine neue Hermes-Sitzung öffnen. In der alten Sitzung sind die Werkzeuge noch nicht geladen.

5. Test, nur lesen:

```text
Daj mi Elvisa. Samo čitanje, ništa ne mijenjaj.
```

Elvis Hurtić ist Kandidat 527 und dient nur zum Lesen. Bei diesem Test keine Änderung, keinen Restore und keine Freigabe starten.

## Was die Antwort bedeutet

- Hermes verlangt `CRM_MCP_SERVER_TOKEN`: Schritt 2 ist nicht geladen. `config.yaml` prüfen und eine neue Sitzung starten.
- `Lesen ist fuer diese Rolle nicht erlaubt`: Es ist der gemeinsame Token verbunden, nicht das WorkOS-Konto. Schritt 3 mit einer der beiden E-Mails wiederholen.
- Name und `kandidat_id` kommen zurück: die Verbindung funktioniert.

Nach der Anmeldung speichert Hermes den Token bei sich. Eine neue Anmeldung braucht es erst, wenn der Token abläuft oder sich eine Rolle ändert. Nach einer Rollenänderung abmelden und neu anmelden. Der alte Token enthält die neue Rolle nicht.
