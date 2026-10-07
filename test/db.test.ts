import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
      const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(tsUrl))) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

import assert from "node:assert/strict";
import test from "node:test";

const { parseDatabaseConfig, safeDbError } = await import("../src/db.ts");

const sample = "mysql://reader:pw-do-not-keep@mysql-example.aivencloud.com:26718/defaultdb?ssl-mode=REQUIRED";

test("oeffentliche MySQL-Adresse wird mit TLS gelesen und das Passwort bleibt in der Konfiguration", () => {
  const config = parseDatabaseConfig(sample);
  assert.equal(config.host, "mysql-example.aivencloud.com");
  assert.equal(config.port, 26718);
  assert.equal(config.user, "reader");
  assert.equal(config.database, "defaultdb");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(config.ssl.ca.includes("PRIVATE"), false);
  assert.equal(config.multipleStatements, false);
  assert.equal(config.password, "pw-do-not-keep");
});

test("bestehende Aiven-Adresse bleibt nutzbar und ein fehlendes Passwort nennt die Adresse nicht", () => {
  const config = parseDatabaseConfig("mysql://reader:pw-do-not-keep@mysql-example.l.aivencloud.com:26718/defaultdb");
  assert.equal(config.host, "mysql-example.l.aivencloud.com");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.throws(
    () => parseDatabaseConfig("mysql://reader@mysql-example.aivencloud.com/defaultdb"),
    (error: Error) => {
      assert.match(error.message, /Passwort/);
      assert.equal(error.message.includes("mysql://"), false);
      return true;
    },
  );
});

test("Datenbankfehler nennen hoechstens einen Fehlercode", () => {
  const error = safeDbError({
    code: "ER_ACCESS_DENIED_ERROR",
    message: "Access denied for mysql://reader:pw-do-not-keep@mysql-example.aivencloud.com/defaultdb",
  });
  assert.equal(error.message, "Datenbankabfrage fehlgeschlagen (ER_ACCESS_DENIED_ERROR).");
  assert.equal(error.message.includes("pw-do-not-keep"), false);
  const bare = safeDbError(new Error("mysql://reader:pw-do-not-keep@host/db"));
  assert.equal(bare.message, "Datenbankabfrage fehlgeschlagen.");
  const tls = safeDbError(new Error("self signed certificate in certificate chain mysql://reader:pw-do-not-keep@host/db"));
  assert.match(tls.message, /self signed certificate/);
  assert.equal(tls.message.includes("pw-do-not-keep"), false);
  assert.equal(tls.message.includes("mysql://"), false);
});
