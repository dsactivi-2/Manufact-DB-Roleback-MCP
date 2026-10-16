export const FILTER_KEYS = [
  "name", "eu_buerger", "alter_von", "alter_bis", "position_text", "berufsgruppe_id",
  "sprache", "niveau", "fertigkeit", "archived", "telefon",
] as const;

export type FilterStep = Partial<Record<(typeof FILTER_KEYS)[number], string | number | boolean>>;

export interface FilterCache {
  id: string;
  naziv: string;
  parent_id: string | null;
  steps: FilterStep[];
  total_count: number;
  created_at: string;
}

const MAX_CACHES = 100;
const MAX_STEPS = 12;
const caches = new Map<string, FilterCache>();

export function resetFilterCaches(): void {
  caches.clear();
}

function stepFrom(args: object): FilterStep {
  const source = args as Record<string, unknown>;
  const step: FilterStep = {};
  for (const key of FILTER_KEYS) {
    const value = source[key];
    if (value !== undefined) step[key] = value as string | number | boolean;
  }
  return step;
}

function labelFor(steps: FilterStep[], requested?: string): string {
  if (requested && requested.trim()) return requested.trim().slice(0, 80);
  const last = steps.at(-1) ?? {};
  const piece = last.position_text || last.name || last.sprache || last.telefon || "filter";
  return String(piece).slice(0, 80);
}

export function resolveCandidateQuery(args: object): {
  query: Record<string, unknown>;
  steps: FilterStep[];
  parent_id: string | null;
  cache_id: string | null;
  naziv?: string;
  save: boolean;
} {
  const source = args as Record<string, unknown>;
  const cacheId = typeof source.cache_id === "string" ? source.cache_id : undefined;
  const parent = cacheId ? caches.get(cacheId) : undefined;
  if (cacheId && !parent) throw new Error("Sacuvani filter ne postoji ili je istekao.");
  const added = stepFrom(source);
  const steps = [...(parent?.steps ?? [])];
  if (Object.keys(added).length > 0) steps.push(added);
  if (steps.length > MAX_STEPS) throw new Error("Najvise 12 uzastopnih filtera.");
  const query: Record<string, unknown> = {};
  if (steps.length > 0) query.koraci = steps;
  if (source.page_size !== undefined) query.page_size = source.page_size;
  if (source.cursor !== undefined) query.cursor = source.cursor;
  if (source.count_only !== undefined) query.count_only = source.count_only;
  if (source.ukljuci_telefon !== undefined) query.ukljuci_telefon = source.ukljuci_telefon;
  const narrowed = Object.keys(added).length > 0;
  const save = narrowed && source.cursor === undefined && steps.length > 0;
  return {
    query,
    steps,
    parent_id: parent?.id ?? null,
    cache_id: parent?.id ?? null,
    naziv: typeof source.naziv === "string" ? source.naziv : undefined,
    save,
  };
}

export function rememberFilterCache(input: { naziv?: string; parent_id: string | null; steps: FilterStep[]; total_count: number }): FilterCache {
  while (caches.size >= MAX_CACHES) {
    const oldest = [...caches.values()].sort((left, right) => left.created_at.localeCompare(right.created_at))[0];
    if (!oldest) break;
    caches.delete(oldest.id);
  }
  const saved: FilterCache = {
    id: cacheId(),
    naziv: labelFor(input.steps, input.naziv),
    parent_id: input.parent_id,
    steps: input.steps.map((step) => ({ ...step })),
    total_count: input.total_count,
    created_at: new Date().toISOString(),
  };
  caches.set(saved.id, saved);
  return saved;
}

function cacheId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "fc_" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function listFilterCaches(): FilterCache[] {
  return [...caches.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function deleteFilterCache(id: string): boolean {
  return caches.delete(id);
}
