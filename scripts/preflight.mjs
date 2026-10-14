import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
      const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (fs.existsSync(fileURLToPath(tsUrl))) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { assertMcpMutationConfiguration, hasProductionWritableEntity, workerConfigurationErrors } = await import("../src/config.ts");

const root = fileURLToPath(new URL("..", import.meta.url));
const activation = process.argv.includes("--activation");
const errors = [];
const pending = [];

for (const relative of [
  "contracts/mutations.ts", "sql/migrations/001_history_schema.sql", "src/worker/http.ts",
  "cloudflare/worker/wrangler.jsonc", "cloudflare/worker/wrangler.staging.jsonc",
  "config/activation-plan.example.json",
]) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`MISSING_FILE:${relative}`);
}

const production = readJson("cloudflare/worker/wrangler.jsonc");
const productionVars = production.vars ?? {};
const checkedVars = { ...productionVars };
if (checkedVars.WRITES_ENABLED === "true" && !checkedVars.IDENTITY_ASSERTION_PUBLIC_KEY) {
  checkedVars.IDENTITY_ASSERTION_PUBLIC_KEY = "configured-outside-git";
}
for (const message of workerConfigurationErrors(checkedVars)) errors.push(`PRODUCTION_CONFIG:${message}`);
for (const [name, expected] of Object.entries({ WRITES_ENABLED: "true", RESTORES_ENABLED: "true", REQUIRE_APPROVAL: "true", ALLOW_TEST_ENTITIES: "false" })) {
  if (productionVars[name] !== expected) errors.push(`PRODUCTION_FLAG:${name}_MUST_BE_${expected}`);
}

if (!hasProductionWritableEntity()) pending.push("REAL_ENTITY_ALLOWLIST");
if (!Array.isArray(production.r2_buckets) || production.r2_buckets.length === 0) pending.push("R2_BINDING");
if (!Array.isArray(production.triggers?.crons) || production.triggers.crons.length === 0) pending.push("OUTBOX_CRON");

const localPlanPath = path.join(root, "config", "activation-plan.local.json");
if (!fs.existsSync(localPlanPath)) {
  pending.push("ACTIVATION_PLAN");
} else {
  const plan = JSON.parse(fs.readFileSync(localPlanPath, "utf8"));
  for (const name of ["policyVersion", "readAuthorizationDecision", "writeAuthorizationDecision", "approvalProvider", "approvedTestRecord", "approvedBy", "approvedAt"]) {
    if (!nonempty(plan[name])) pending.push(`PLAN_${name.toUpperCase()}`);
  }
  if (!Array.isArray(plan.realEntities) || plan.realEntities.length === 0) pending.push("PLAN_REALENTITIES");
  if (!nonempty(plan.r2?.bucketName) || !nonempty(plan.r2?.cron)) pending.push("PLAN_R2");
}

if (activation) {
  try { assertMcpMutationConfiguration(process.env); } catch (error) { errors.push(`MCP_ACTIVATION:${safe(error)}`); }
  for (const message of workerConfigurationErrors({ ...productionVars, ...process.env })) errors.push(`WORKER_ACTIVATION:${message}`);
  errors.push(...pending.map((item) => `PENDING_DECISION:${item}`));
}

const result = {
  ok: errors.length === 0,
  mode: activation ? "activation" : "repository",
  productionFlags: {
    mutationTools: process.env.CRM_MUTATION_TOOLS_ENABLED ?? "false",
    writes: productionVars.WRITES_ENABLED,
    restores: productionVars.RESTORES_ENABLED,
    approval: productionVars.REQUIRE_APPROVAL,
    testEntities: productionVars.ALLOW_TEST_ENTITIES,
  },
  pending: [...new Set(pending)],
  errors: [...new Set(errors)],
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safe(error) {
  const text = error instanceof Error ? error.message : "PREFLIGHT_FAILED";
  return text.replace(/[^A-Za-z0-9_.:= -]/g, "").slice(0, 300);
}
