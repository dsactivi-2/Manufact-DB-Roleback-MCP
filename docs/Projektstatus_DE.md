# Projektstatus: Manufact DB Rollback MCP

Stand: 07.10.2026

Hallo zusammen,

hier ist der aktuelle Stand des Projekts **Manufact-DB-Rollback-MCP**.

## Zielarchitektur

Der aktuell umgesetzte Datenfluss sieht wie folgt aus:

```text
ChatGPT / Codex
      ↓
MCP-Server
      ↓
Cloudflare Worker
      ↓
Cloudflare Hyperdrive
      ↓
Aiven MySQL – Datenbank jsicrm
      ↓
Änderungshistorie und Outbox

Outbox-Prozess → zukünftige R2-Archivierung
```

Die Änderungshistorie soll ausschließlich Änderungen erfassen, die über die MCP-Formulare ausgeführt werden. Eine separate Überwachung direkter Änderungen durch das CRM auf dem Hetzner-Server ist derzeit nicht vorgesehen. Die zuständigen Mitarbeiter sollen die relevanten Änderungen ebenfalls über die MCP-Formulare durchführen.

## Datenbank

Vor den Arbeiten wurde ein vollständiges Backup der produktiven Aiven-Datenbank `jsicrm` erstellt.

In der bestehenden Datenbank wurden sieben neue Tabellen für Historie, Rollback, Freigaben und Archivierung angelegt:

- `rb_entity_state`
- `rb_field_state`
- `rb_baselines`
- `rb_events`
- `rb_requests`
- `rb_outbox`
- `rb_approvals`

Die vorhandenen CRM-Fachtabellen und ihre Daten wurden nicht verändert.

Für den Zugriff über Cloudflare wurde ein eigener, eingeschränkter MySQL-Benutzer eingerichtet. Dieser Benutzer verwendet nicht den Aiven-Administratorzugang. Aktuell besitzt er ausschließlich Leserechte auf freigegebene CRM-Spalten sowie Leserechte auf den neuen Historientabellen. Produktive Schreibrechte wurden noch nicht aktiviert.

## Cloudflare Worker und Hyperdrive

Der Cloudflare Worker `manufact-db-rollback` wurde eingerichtet und veröffentlicht.

Öffentliche Worker-Adresse:

```text
https://manufact-db-rollback.6f484zn9bd.workers.dev
```

Der Worker greift über die Hyperdrive-Verbindung `manufact-jsicrm-fresh` auf die Aiven-Datenbank zu. Die Verbindung verwendet TLS mit Identitätsprüfung. Der Hyperdrive-Cache ist deaktiviert, damit Datenbankabfragen keine veralteten CRM-Daten liefern.

Der Worker stellt kontrollierte Endpunkte für folgende Funktionen bereit:

- CRM-Leseabfragen
- Anzeige der Änderungshistorie
- Vorschau einer geplanten Änderung
- Ausführung einer freigegebenen Änderung
- Vorschau einer Wiederherstellung
- Ausführung einer freigegebenen Wiederherstellung

Eine freie SQL-Schnittstelle ist deaktiviert. Dadurch können Benutzer oder MCP-Tools keine beliebigen SQL-Befehle an die Datenbank senden.

## MCP-Server

Der MCP-Server wurde mit der Cloudflare-Verbindung integriert und veröffentlicht.

MCP-Adresse:

```text
https://keen-forge-ldf39.run.mcp-use.com/mcp
```

Aktive Bereitstellung:

- Deployment: `#14`
- Branch: `feature/cloudflare-read-gateway-20261007`
- Commit: `42e0324387b32697f10167af78956227ad60def4`
- Status: läuft, Build-Pipeline abgeschlossen

Der MCP-Server verwendet Cloudflare als Transportweg. Die Zugangsdaten und kryptografischen Schlüssel sind als geschützte Umgebungsvariablen hinterlegt und befinden sich nicht im Git-Repository.

## Identität und Zugriffsschutz

Für Schreib- und Wiederherstellungsanfragen wurde eine signierte Identitätsprüfung mit Ed25519 eingerichtet.

Dabei gilt:

- Der allgemeine Service-Token erlaubt nur Lesezugriffe.
- Schreibzugriffe benötigen zusätzlich eine gültig signierte Benutzeridentität.
- Die Signatur ist an den Inhalt der jeweiligen Anfrage gebunden.
- Wiederholte oder veränderte Anfragen können dadurch erkannt und abgewiesen werden.
- Änderungen und Wiederherstellungen erfordern eine Freigabe.

## Historie und Rollback

Die technische Grundlage für folgende Funktionen ist implementiert:

- atomare Ausführung von Datenänderung und Historieneintrag
- Speicherung des alten und neuen Feldwerts
- Revisionsprüfung zur Erkennung paralleler Änderungen
- Idempotenzschutz gegen doppelte Ausführung derselben Anfrage
- Baselines für spätere Wiederherstellungen
- selektive Wiederherstellung einzelner Felder
- Konflikterkennung vor einem Rollback
- Outbox-Einträge für die spätere Archivierung
- Wiederholungslogik bei fehlgeschlagener Outbox-Verarbeitung
- Verarbeitung von `NULL`, Ganzzahlen und Dezimalwerten

Wenn das Schreiben des Historieneintrags fehlschlägt, wird auch die eigentliche CRM-Änderung zurückgerollt. Dadurch entsteht keine produktive Änderung ohne zugehörige Historie.

## Aktueller Sicherheitszustand

Produktive Änderungen und Wiederherstellungen sind derzeit bewusst deaktiviert:

```text
WRITES_ENABLED=false
RESTORES_ENABLED=false
REQUIRE_APPROVAL=true
ALLOW_TEST_ENTITIES=false
```

Damit ist die produktive Verbindung bereits aktiv und lesbar, reale Datensätze können über den neuen Weg aber noch nicht geändert oder wiederhergestellt werden.

Zusätzlich ist für reale CRM-Entitäten noch keine Schreib-Allowlist freigeschaltet. Das verhindert, dass versehentlich unbekannte Tabellen oder Felder geändert werden.

## Durchgeführte Prüfungen

Folgende Live-Prüfungen waren erfolgreich:

- Worker-Healthcheck: erfolgreich
- Zugriff ohne Authentifizierung: korrekt mit HTTP 401 abgewiesen
- CRM-Statistikabfrage über Cloudflare und Aiven: erfolgreich
- spezialisierte Lese-Endpunkte: erfolgreich
- signierte Abfrage der Änderungshistorie: erfolgreich
- Schreibversuch bei deaktivierten Schreibzugriffen: korrekt mit HTTP 403 abgewiesen
- öffentlicher MCP-Aufruf `crm_stats`: erfolgreich
- öffentlicher MCP-Aufruf `crm_history_list`: erfolgreich

Zusätzlich wurden die automatisierten Tests ausgeführt:

- Hauptprojekt: 25 von 25 Tests erfolgreich
- TypeScript-Typprüfung: erfolgreich
- Produktions-Build: erfolgreich
- Worker-Architekturtests: 3 von 3 erfolgreich
- Wrangler-Dry-Run-Build: erfolgreich
- MySQL-Integrationstests mit MySQL 8.0.30: 2 von 2 erfolgreich

Die Integrationstests decken unter anderem atomare Änderungen, Idempotenz, Wiederherstellungen, Konflikte, parallele Verbindungen und Outbox-Wiederholungen ab.

## Aktueller Datenstand

Die produktive Verbindung konnte folgende Daten aus der Aiven-Datenbank lesen:

- Kandidaten insgesamt: 122.004
- aktive Kandidaten: 117.558
- Firmen: 1.223
- Aufträge: 239

Die Änderungshistorie ist aktuell leer, weil produktive Schreibvorgänge über MCP noch nicht freigeschaltet wurden.

## Noch offene Arbeiten

Als Nächstes müssen folgende Punkte gemeinsam festgelegt und umgesetzt werden:

1. Festlegen, welche CRM-Formulare, Entitäten und Felder über MCP geändert werden dürfen.
2. Zuordnung dieser Felder zu den exakten Tabellen, Spalten und Datentypen in `jsicrm`.
3. Vergabe minimaler MySQL-Schreibrechte ausschließlich für diese freigegebenen Spalten und Historientabellen.
4. Fertigstellung des Freigabeprozesses für Änderungen und Rollbacks.
5. Kontrollierter Test mit einem ausdrücklich ausgewählten Testdatensatz: Vorschau → Freigabe → Änderung → Historie → Wiederherstellung.
6. Erst nach erfolgreichem Test Aktivierung produktiver Schreib- und Wiederherstellungsfunktionen.
7. Spätere Einrichtung eines R2-Buckets und eines Outbox-Prozesses für die langfristige Archivierung.

Der aktuelle Stand ermöglicht bereits sichere CRM-Lesezugriffe über MCP, Cloudflare Worker und Hyperdrive. Die technische Grundlage für Historie und Rollback ist vorhanden und getestet. Vor der Freischaltung produktiver Änderungen fehlen hauptsächlich die fachliche Feldfreigabe, die minimalen Datenbankrechte, der Freigabeprozess und ein kontrollierter End-to-End-Test.
