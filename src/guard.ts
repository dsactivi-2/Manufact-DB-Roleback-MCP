const FORBIDDEN_MARKERS = [
  "00184318f6854e1788f6061e24eaf24f",
  "71d03de751b74a5ca1f71dd382328c2b",
  "crm-pipedrive-worker",
  "activi-dsactivi-d23a.b.aivencloud.com",
];

type GuardedEnv = { CRM_DATABASE_URL?: string; CRM_HYPERDRIVE_ID?: string; HYPERDRIVE_CONFIG_ID?: string; DATABASE_URL?: string; CRM_WORKER_BASE_URL?: string };

export function isolationViolations(env: GuardedEnv = process.env): string[] {
  const blob = [env.CRM_DATABASE_URL, env.CRM_HYPERDRIVE_ID, env.HYPERDRIVE_CONFIG_ID, env.DATABASE_URL, env.CRM_WORKER_BASE_URL].join(" ");
  return FORBIDDEN_MARKERS.filter((marker) => blob.includes(marker));
}

export function assertSeparateInfrastructure(env: GuardedEnv = process.env): void {
  if (isolationViolations(env).length > 0) {
    throw new Error("Die alte oder produktive Datenbank-Infrastruktur ist verboten.");
  }
}

export function assertSafeDatabaseTarget(host: string, schema: string): void {
  const target = host + " " + schema;
  if (FORBIDDEN_MARKERS.some((marker) => target.includes(marker)) || schema === "defaultdb") {
    throw new Error("Dieses Datenbankziel ist fuer den neuen Worker gesperrt.");
  }
}

export function databaseUrl(env: GuardedEnv = process.env): string {
  assertSeparateInfrastructure(env);
  const url = env.CRM_DATABASE_URL ?? "";
  if (!url) throw new Error("CRM_DATABASE_URL fehlt. Ein neuer, eigener Datenbankanschluss ist noch nicht gesetzt.");
  return url;
}
