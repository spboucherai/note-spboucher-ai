/**
 * file: src/lib/client/commands.ts
 * description: command registry of the Universal Command Center (⌘K). Any feature registers its commands here (`registerCommands`
 *   returns an unregister function — call it from a React effect); the palette lists them with a fuzzy search and remembers the
 *   recently used ones on the device. Pure logic (no React, no DOM beyond localStorage): unit-tested in tests/unit/next-web-commands.test.ts.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
export interface Command {
  /** Stable id, namespaced: `nav.home`, `editor.insert.mermaid`, `page.export.md`… */
  id: string;
  title: string;
  /** Group heading in the palette: "Go to", "Create", "Insert", "Page", "Editor", "View", "AI", "Settings"… */
  group: string;
  /** Extra search terms (synonyms, French/English variants). */
  keywords?: string;
  /** Shortcut hint shown on the right, e.g. "⌘⇧N". Display only. */
  shortcut?: string;
  /** Name of a lucide icon or an emoji — resolved by the palette (the registry stays free of React). */
  icon?: string;
  /** Smaller text under/next to the title. */
  hint?: string;
  /** Hidden when it returns false (evaluated when the palette opens and on each query). */
  when?: () => boolean;
  /** Higher = earlier among equal scores (default 0). */
  priority?: number;
  run: () => void | Promise<void>;
}

const registry = new Map<string, Command>();
const listeners = new Set<() => void>();
let snapshot: Command[] = [];
const emit = () => { snapshot = [...registry.values()]; for (const l of listeners) l(); };

/** Register (or replace, by id) commands. Returns the function that removes exactly these registrations. */
export function registerCommands(cmds: Command[]): () => void {
  for (const c of cmds) registry.set(c.id, c);
  emit();
  return () => { let changed = false; for (const c of cmds) if (registry.get(c.id) === c) { registry.delete(c.id); changed = true; } if (changed) emit(); };
}
export const subscribeCommands = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** Stable array between changes (usable with useSyncExternalStore). */
export const getCommands = (): Command[] => snapshot;
export const availableCommands = (): Command[] => snapshot.filter((c) => { try { return c.when ? c.when() : true; } catch { return false; } });
export const getCommand = (id: string) => registry.get(id);
/** Tests only. */
export const _resetCommands = () => { registry.clear(); emit(); };

/* ------------------------------------------------------------------ fuzzy search ------------------------------------------------------------------ */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isBoundary = (s: string, i: number) => i === 0 || /[\s\-_/.:·›(]/.test(s[i - 1]) || (s[i - 1] === s[i - 1].toLowerCase() && s[i] !== s[i].toLowerCase());

export interface FuzzyMatch { score: number; /** indexes of the matched characters in the original text (for highlighting) */ positions: number[] }
/**
 * Subsequence match of `query` in `text`, accent- and case-insensitive. Score (higher is better): exact = 1000, prefix = 800 + coverage,
 * substring = 600 (+ word-boundary bonus), otherwise a sum per matched character: +16 on a word boundary, +10 when consecutive, +2
 * otherwise, minus a small penalty for the gaps and for the length of the text. Returns null when `query` is not a subsequence.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.trim()); if (!q) return { score: 0, positions: [] };
  const t = fold(text); if (!t) return null;
  // folding never changes the length of the strings handled here (precomposed Latin letters lose their combining mark, 1 → 1 after NFD strip)
  const sameLen = t.length === text.length;
  if (t === q) return { score: 1000, positions: range(0, q.length) };
  const at = t.indexOf(q);
  if (at === 0) return { score: 800 + Math.round((q.length / t.length) * 100), positions: range(0, q.length) };
  if (at > 0) return { score: 600 + (isBoundary(sameLen ? text : t, at) ? 80 : 0) - Math.min(40, at), positions: range(at, at + q.length) };
  // multi-word queries: every word must match somewhere (order-free), e.g. "dark mode" ~ "mode sombre dark"
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) { let score = 0; const positions: number[] = []; for (const w of words) { const m = fuzzyMatch(w, text); if (!m) return null; score += m.score; positions.push(...m.positions); } return { score: Math.round(score / words.length) - 20, positions: [...new Set(positions)].sort((a, b) => a - b) }; }
  let score = 0, ti = 0, last = -2; const positions: number[] = [];
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    // prefer a word-boundary occurrence of this character if one exists ahead, else the next occurrence
    for (let k = ti; k < t.length; k++) if (t[k] === q[qi]) { if (found < 0) found = k; if (isBoundary(sameLen ? text : t, k)) { found = k; break; } if (k - ti > 24) break; }
    if (found < 0) return null;
    // a boundary jump must not skip characters the rest of the query still needs: fall back to the nearest occurrence when the tail no longer fits
    if (found !== t.indexOf(q[qi], ti) && !isSubsequence(q.slice(qi + 1), t.slice(found + 1))) found = t.indexOf(q[qi], ti);
    score += isBoundary(sameLen ? text : t, found) ? 16 : found === last + 1 ? 10 : 2;
    if (last >= 0) score -= Math.min(6, found - last - 1);
    positions.push(found); last = found; ti = found + 1;
  }
  return { score: Math.max(1, score - Math.round(t.length / 12)), positions };
}
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
function isSubsequence(q: string, t: string) { let i = 0; for (let k = 0; k < t.length && i < q.length; k++) if (t[k] === q[i]) i++; return i === q.length; }

export interface Ranked<T> { item: T; score: number; positions: number[] }
/**
 * Rank `items` for `query`. The title counts fully; keywords count for 60 % (and yield no highlight positions). `boost(item)` is added
 * to matching items only (recency, priority). Stable for equal scores. Empty query: every item, in input order, boost applied.
 */
export function fuzzyRank<T>(query: string, items: T[], text: (item: T) => { title: string; keywords?: string }, boost?: (item: T) => number, limit = 50): Ranked<T>[] {
  const q = query.trim(); const out: (Ranked<T> & { i: number })[] = [];
  items.forEach((item, i) => {
    const { title, keywords } = text(item);
    if (!q) { out.push({ item, score: boost?.(item) ?? 0, positions: [], i }); return; }
    const a = fuzzyMatch(q, title); const b = keywords ? fuzzyMatch(q, keywords) : null;
    const sa = a?.score ?? -1, sb = b ? Math.round(b.score * 0.6) : -1; if (sa < 0 && sb < 0) return;
    out.push({ item, score: Math.max(sa, sb) + (boost?.(item) ?? 0), positions: sa >= sb && a ? a.positions : [], i });
  });
  return out.sort((x, y) => y.score - x.score || x.i - y.i).slice(0, limit).map(({ i: _i, ...r }) => r);
}

/* ------------------------------------------------------------------ recents (device-local) ------------------------------------------------------------------ */
const RECENT_KEY = "note-cmd-recent"; const RECENT_MAX = 12;
export interface RecentEntry { kind: "command" | "page"; id: string; title?: string; icon?: string | null; at: number }
const store = (): Storage | null => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };
export function readRecents(): RecentEntry[] { try { const v = JSON.parse(store()?.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string" && (e.kind === "command" || e.kind === "page")) : []; } catch { return []; } }
/** Most recent first, de-duplicated by kind + id, capped at 12. */
export function pushRecent(list: RecentEntry[], e: Omit<RecentEntry, "at">, now = Date.now()): RecentEntry[] { return [{ ...e, at: now }, ...list.filter((x) => !(x.kind === e.kind && x.id === e.id))].slice(0, RECENT_MAX); }
export function rememberRecent(e: Omit<RecentEntry, "at">): void { try { store()?.setItem(RECENT_KEY, JSON.stringify(pushRecent(readRecents(), e))); } catch { /* storage full or disabled: recents are a comfort, not a feature gate */ } }
/** Boost for ranking: the most recent entry gets +40, decreasing with rank. */
export const recencyBoost = (recents: RecentEntry[], kind: RecentEntry["kind"], id: string) => { const i = recents.findIndex((r) => r.kind === kind && r.id === id); return i < 0 ? 0 : Math.max(4, 40 - i * 4); };

/** Run a command by id (no-op when unknown or currently unavailable) and remember it. */
export async function runCommand(id: string): Promise<boolean> { const c = registry.get(id); if (!c || (c.when && !c.when())) return false; rememberRecent({ kind: "command", id }); await c.run(); return true; }
