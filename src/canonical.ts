import { createHash, randomUUID } from "node:crypto";

export type TypedValue =
  | { type: "null" }
  | { type: "string"; value: string }
  | { type: "decimal"; value: string }
  | { type: "integer"; value: string };

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

export function sqlUtc(date: Date): string {
  const iso = date.toISOString();
  const time = iso.slice(11, 23);
  const [clock, millis] = time.split(".");
  return iso.slice(0, 10) + " " + clock + "." + (millis ?? "000").padEnd(6, "0");
}

export function sameTyped(left: TypedValue, right: TypedValue): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
