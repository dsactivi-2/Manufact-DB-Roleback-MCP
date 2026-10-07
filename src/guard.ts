const OLD_MARKERS = ["00184318f6854e1788f6061e24eaf24f", "crm-pipedrive-worker"];

export function assertSeparateInfrastructure(env: NodeJS.ProcessEnv = process.env): void {
  const blob = [env.CRM_DATABASE_URL, env.CRM_HYPERDRIVE_ID, env.DATABASE_URL].filter(Boolean).join(" ");
  for (const marker of OLD_MARKERS) {
    if (blob.includes(marker)) {
      throw new Error("Die alte Server-Infrastruktur ist verboten. Auch ein Hyperdrive muss neu sein.");
    }
  }
}

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  assertSeparateInfrastructure(env);
  const url = env.CRM_DATABASE_URL ?? "";
  if (!url) throw new Error("CRM_DATABASE_URL fehlt. Ein neuer, eigener Datenbankanschluss ist noch nicht gesetzt.");
  return url;
}
