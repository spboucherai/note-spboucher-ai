/**
 * file: src/lib/editor/citations.ts
 * description: resolution of `citation` / `bibliography` nodes (SPEC §2, §4.14). Every citation of a page asks this resolver for its
 *   reference; the ids asked within one short window are sent as ONE `GET /api/research/references?ids=` (≤ 200 ids per request, the
 *   server's limit) and the answers are cached per id, so a page with fifty citations costs one request and a re-render costs none.
 *   An id the server does not return is remembered as missing (deleted reference). Nothing here filters a library client-side.
 *   The resolver is a plain object with an injected fetcher (unit-tested without a browser); `referenceResolver` is the app's instance.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { CiteRef } from "@/lib/research/cite";

export interface ResolvedRef extends CiteRef { id: string; /** author–year, computed by the server ("Doe & Roe (2021)") */ label?: string; /** formatted entry, computed by the server */ citation?: string; attachmentId?: string | null; pageId?: string | null }
/** `undefined` = not asked yet or in flight · `null` = the server does not have it · else the reference. */
export type RefState = ResolvedRef | null | undefined;
export interface ReferenceResolver {
  /** Cached state, without triggering anything. */
  peek: (id: string) => RefState;
  /** Resolves one id (batched with the others asked in the same window). Never rejects: a failed request resolves `undefined` and is retried on the next ask. */
  load: (id: string) => Promise<RefState>;
  loadMany: (ids: readonly string[]) => Promise<Map<string, RefState>>;
  /** Forget one id, or everything (a reference was edited or deleted). Subscribers are told. */
  invalidate: (id?: string) => void;
  subscribe: (fn: () => void) => () => void;
  /** Last request error (shown by the bibliography), cleared by the next success. */
  error: () => Error | null;
}
export const MAX_IDS_PER_REQUEST = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRefId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** URL of one batch: ids de-duplicated and sorted so the same set always gives the same (cacheable) URL. */
export const referencesUrl = (ids: readonly string[]) => `/api/research/references?ids=${[...new Set(ids)].sort().join(",")}`;

export function createReferenceResolver(fetchIds: (ids: string[]) => Promise<ResolvedRef[]>, opts: { windowMs?: number; ttlMs?: number; now?: () => number; schedule?: (fn: () => void, ms: number) => unknown } = {}): ReferenceResolver {
  const windowMs = opts.windowMs ?? 16, ttl = opts.ttlMs ?? 120_000, now = opts.now ?? Date.now, schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cache = new Map<string, { at: number; value: ResolvedRef | null }>(); const waiting = new Map<string, { promise: Promise<RefState>; resolve: (v: RefState) => void }>();
  let queue: string[] = []; let timer = false; let lastError: Error | null = null; const subs = new Set<() => void>();
  const tell = () => { for (const f of [...subs]) { try { f(); } catch { /* a subscriber must not break the others */ } } };
  const fresh = (id: string) => { const c = cache.get(id); return c && now() - c.at < ttl ? c : undefined; };
  async function flush() {
    timer = false; const ids = queue; queue = []; if (!ids.length) return;
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const part = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      try {
        const rows = await fetchIds(part); const got = new Map((Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.id === "string").map((r) => [r.id, r])); const at = now();
        // exactly what was asked: a row that was not asked for (a server ignoring `ids`) is not cached, an id not answered is missing
        for (const id of part) { const v = got.get(id) ?? null; cache.set(id, { at, value: v }); waiting.get(id)?.resolve(v); waiting.delete(id); }
        lastError = null;
      } catch (e) { lastError = e instanceof Error ? e : new Error(String(e)); for (const id of part) { waiting.get(id)?.resolve(undefined); waiting.delete(id); } }
    }
    tell();
  }
  const load = (id: string): Promise<RefState> => {
    if (!isRefId(id)) return Promise.resolve(null);
    const c = fresh(id); if (c) return Promise.resolve(c.value);
    const w = waiting.get(id); if (w) return w.promise;
    let resolve!: (v: RefState) => void; const promise = new Promise<RefState>((r) => { resolve = r; }); waiting.set(id, { promise, resolve });
    queue.push(id); if (!timer) { timer = true; schedule(() => { void flush(); }, windowMs); }
    return promise;
  };
  return {
    peek: (id) => (isRefId(id) ? fresh(id)?.value : null), load,
    loadMany: async (ids) => { const uniq = [...new Set(ids)]; const values = await Promise.all(uniq.map(load)); return new Map(uniq.map((id, i) => [id, values[i]])); },
    invalidate: (id) => { if (id) cache.delete(id); else cache.clear(); tell(); },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    error: () => lastError,
  };
}
/** "Gorton & Metrick (2019)" → "Gorton & Metrick 2019": the label cached in the node ("Author Year", SPEC §2). */
export const labelFromServer = (label: string) => label.replace(/\s*\((.+)\)$/, " $1");
