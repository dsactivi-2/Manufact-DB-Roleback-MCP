import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_JSON_URI = "crm://guides/crm_search_guide.json";
export const GUIDE_MARKDOWN_URI = "crm://guides/crm_search_guide.md";

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "../skills/crm-kandidatensuche");

const files = {
  json: "guides/crm_search_guide.json",
  markdown: "guides/crm_search_guide.md",
} as const;

export function readGuide(kind: keyof typeof files): string {
  const relative = files[kind];
  return readFileSync(join(skillRoot, relative), "utf8");
}
