import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./canonical.js";

export interface Actor {
  issuer: string;
  subject: string;
  scopes: string[];
}

export interface AssertionInput {
  actor: Actor;
  audience: string;
  requestSha256: string;
  now?: Date;
  ttlSeconds?: number;
}

export const MCP_ISSUER = "manufact-db-rollback-mcp";
export const WORKER_AUDIENCE = "manufact-db-rollback-worker";
const HEADER = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");

export function actorFromSharedToken(): Actor {
  return { issuer: MCP_ISSUER, subject: "shared-token", scopes: ["crm:read"] };
}

export function actorFromOAuth(auth: { user?: { id?: string }; payload?: Record<string, unknown>; scopes?: string[] }): Actor {
  const payload = auth.payload ?? {};
  const subject = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub.trim() : "";
  const scopes = [...new Set((auth.scopes ?? []).filter((scope) => scope !== "crm:write" || subject.length > 0))];
  if (!subject) return { issuer: MCP_ISSUER, subject: auth.user?.id || "unknown", scopes: scopes.filter((scope) => scope !== "crm:write") };
  return { issuer: MCP_ISSUER, subject, scopes };
}

export function canWrite(actor: Actor): boolean {
  return actor.subject !== "shared-token" && actor.subject !== "unknown" && actor.scopes.includes("crm:write");
}

export function principalHash(actor: Actor): string {
  return sha256(actor.issuer + "\n" + actor.subject);
}

export async function signAssertion(privatePem: string, input: AssertionInput): Promise<string> {
  const now = input.now ?? new Date();
  const payload = {
    iss: input.actor.issuer,
    aud: input.audience,
    sub: input.actor.subject,
    scope: input.actor.scopes.join(" "),
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + (input.ttlSeconds ?? 60),
    jti: sha256(input.requestSha256 + ":" + now.toISOString() + ":" + input.actor.subject),
    request_sha256: input.requestSha256,
  };
  const body = HEADER + "." + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privatePem), { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, key, Buffer.from(body));
  return body + "." + Buffer.from(signature).toString("base64url");
}

export async function verifyAssertion(publicPem: string, token: string, expected: { audience: string; requestSha256: string; now?: Date }): Promise<Actor> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Identitaetsnachweis ist ungueltig.");
  const header = parts[0] ?? "";
  const payloadPart = parts[1] ?? "";
  const signature = parts[2] ?? "";
  if (header !== HEADER) throw new Error("Identitaetsnachweis ist ungueltig.");
  const key = await crypto.subtle.importKey("spki", pemToDer(publicPem), { name: "Ed25519" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(signature, "base64url"), Buffer.from(header + "." + payloadPart));
  if (!valid) throw new Error("Identitaetsnachweis ist ungueltig.");
  const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
  const now = Math.floor((expected.now ?? new Date()).getTime() / 1000);
  if (claims.iss !== MCP_ISSUER || claims.aud !== expected.audience) throw new Error("Identitaetsnachweis ist ungueltig.");
  if (typeof claims.exp !== "number" || claims.exp < now - 5) throw new Error("Identitaetsnachweis ist abgelaufen.");
  if (typeof claims.iat !== "number" || claims.iat > now + 30) throw new Error("Identitaetsnachweis ist ungueltig.");
  if (claims.request_sha256 !== expected.requestSha256) throw new Error("Identitaetsnachweis passt nicht zur Anfrage.");
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  if (!subject) throw new Error("Identitaetsnachweis ist ungueltig.");
  if (subject === "shared-token" && scopes.includes("crm:write")) throw new Error("Ein Lesetoken bekommt keine Schreibrolle.");
  return { issuer: MCP_ISSUER, subject, scopes };
}

export function sameSecret(presented: string, expected: string): boolean {
  if (!expected) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const copy = new Uint8Array(Buffer.from(body, "base64"));
  return copy.buffer;
}

export async function exportPem(key: CryptoKey, kind: "spki" | "pkcs8"): Promise<string> {
  const der = await crypto.subtle.exportKey(kind, key);
  const label = kind === "spki" ? "PUBLIC KEY" : "PRIVATE KEY";
  const b64 = Buffer.from(der).toString("base64");
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return "-----BEGIN " + label + "-----\n" + lines + "\n-----END " + label + "-----\n";
}
