import { ENTITIES } from "./registry.js";

interface Env {
  CRM_MUTATION_TOOLS_ENABLED?: string;
  CRM_TRANSPORT?: string;
  CRM_IDENTITY_ASSERTION_PRIVATE_KEY?: string;
  OAUTH_ISSUER?: string;
  MCP_USE_OAUTH_WORKOS_SUBDOMAIN?: string;
  CRM_MUTATION_POLICY_VERSION?: string;
  WRITES_ENABLED?: string;
  RESTORES_ENABLED?: string;
  REQUIRE_APPROVAL?: string;
  ALLOW_TEST_ENTITIES?: string;
  ENVIRONMENT?: string;
  IDENTITY_ASSERTION_PUBLIC_KEY?: string;
}

export function assertMcpMutationConfiguration(env: Env): void {
  booleanSetting(env, "CRM_MUTATION_TOOLS_ENABLED");
  if (env.CRM_MUTATION_TOOLS_ENABLED !== "true") return;
  if (env.CRM_TRANSPORT !== "cloudflare") throw new Error("Mutation-Werkzeuge brauchen CRM_TRANSPORT=cloudflare.");
  if (!clean(env.CRM_IDENTITY_ASSERTION_PRIVATE_KEY)) throw new Error("Mutation-Werkzeuge brauchen CRM_IDENTITY_ASSERTION_PRIVATE_KEY.");
  if (!clean(env.OAUTH_ISSUER) && !clean(env.MCP_USE_OAUTH_WORKOS_SUBDOMAIN)) throw new Error("Mutation-Werkzeuge brauchen OAuth.");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clean(env.CRM_MUTATION_POLICY_VERSION))) {
    throw new Error("CRM_MUTATION_POLICY_VERSION fehlt oder ist ungueltig.");
  }
}

export function workerConfigurationErrors(env: Env): string[] {
  const errors: string[] = [];
  for (const name of ["WRITES_ENABLED", "RESTORES_ENABLED", "REQUIRE_APPROVAL", "ALLOW_TEST_ENTITIES"]) {
    const value = env[name as keyof Env];
    if (value !== undefined && value !== "true" && value !== "false") errors.push(`${name} muss true oder false sein.`);
  }
  const writes = env.WRITES_ENABLED === "true";
  const restores = env.RESTORES_ENABLED === "true";
  const production = env.ENVIRONMENT === "production";
  if (restores && !writes) errors.push("RESTORES_ENABLED braucht WRITES_ENABLED=true.");
  if (writes && !clean(env.IDENTITY_ASSERTION_PUBLIC_KEY)) errors.push("Writes brauchen IDENTITY_ASSERTION_PUBLIC_KEY.");
  if (writes && env.REQUIRE_APPROVAL === "false") errors.push("Writes ohne Approval sind nicht zugelassen.");
  if (production && env.ALLOW_TEST_ENTITIES === "true") errors.push("Testentitaeten sind in Produktion verboten.");
  if (production && writes && !hasProductionWritableEntity()) errors.push("Produktive Writes brauchen eine freigegebene reale Entity-Allowlist.");
  return errors;
}

export function assertWorkerConfiguration(env: Env): void {
  const errors = workerConfigurationErrors(env);
  if (errors.length > 0) throw new Error(`WORKER_CONFIGURATION_INVALID: ${errors.join(" ")}`);
}

export function hasProductionWritableEntity(): boolean {
  return ENTITIES.some((entity) => !entity.testOnly && entity.schemaVerified && entity.primaryKey && entity.access !== "read" && entity.operations.update && entity.fields.length > 0);
}

function booleanSetting(env: Env, name: string): void {
  const value = env[name as keyof Env];
  if (value !== undefined && value !== "true" && value !== "false") throw new Error(`${name} muss true oder false sein.`);
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}
