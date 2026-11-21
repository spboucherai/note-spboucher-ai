/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/unknown.ts
 * Description      : forward compatibility of the document format (SPEC §0.5:
 *                    unknown content round-trips untouched). ProseMirror
 *                    silently drops what its schema does not know, so
 *                    everything unknown is boxed before the JSON reaches it and
 *                    unboxed in everything the editor emits: - a node of an
 *                    unknown type → `unknownBlock` / `unknownInline` atom, attr
 *                    `raw` = the node verbatim (neutral read-only card); - an
 *                    unknown mark, or a known mark with unknown attrs →
 *                    `unknownMark`, attr `raw` = the mark verbatim (text stays
 *                    editable); - unknown attrs on a known node → moved to the
 *                    reserved attr `xattrs` of that node (the node stays fully
 *                    usable). Pure functions (no DOM, no schema object): tested
 *                    in tests/unit/next-web-unknown.test.ts.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import type { PMNode } from "./text";

export const UNKNOWN_BLOCK = "unknownBlock"; export const UNKNOWN_INLINE = "unknownInline"; export const UNKNOWN_MARK = "unknownMark"; export const XATTRS = "xattrs";
type Mark = NonNullable<PMNode["marks"]>[number];
/** What the schema knows: node → its attr names and whether its content is inline; mark → its attr names. Built once from the Tiptap schema. */
export interface SchemaInfo { nodes: Map<string, { attrs: Set<string>; inlineContent: boolean }>; marks: Map<string, Set<string>> }
export interface UnknownReport { /** node types boxed verbatim */ nodes: string[]; /** mark types boxed verbatim */ marks: string[]; /** "attr on node" kept in xattrs */ attrs: string[] }
const RESERVED = new Set([UNKNOWN_BLOCK, UNKNOWN_INLINE]);

/** Box everything the schema does not know. Returns the same object (by reference) when the document needs no change. */
export function wrapUnknown<T extends PMNode | null | undefined>(doc: T, schema: SchemaInfo): { doc: T; report: UnknownReport } {
  const nodes = new Set<string>(), marks = new Set<string>(), attrs = new Set<string>();
  if (!doc || typeof doc !== "object") return { doc, report: { nodes: [], marks: [], attrs: [] } };
  const wrapMarks = (ms: Mark[] | undefined): Mark[] | undefined => {
    if (!ms?.length) return ms; let changed = false;
    const out = ms.map((m) => { if (m.type === UNKNOWN_MARK) return m; const known = schema.marks.get(m.type); if (known && Object.keys(m.attrs ?? {}).every((k) => known.has(k) || m.attrs![k] == null)) return m; marks.add(m.type); changed = true; return { type: UNKNOWN_MARK, attrs: { raw: m } }; });
    return changed ? out : ms;
  };
  const walk = (n: PMNode, parentInline: boolean): PMNode => {
    if (RESERVED.has(n.type)) return n; // already boxed (a draft restored from this device)
    const known = schema.nodes.get(n.type);
    if (!known) { nodes.add(n.type); return { type: parentInline ? UNKNOWN_INLINE : UNKNOWN_BLOCK, attrs: { raw: n } }; }
    let out = n;
    const ms = wrapMarks(n.marks); if (ms !== n.marks) out = { ...out, marks: ms };
    if (n.attrs && n.type !== "text") {
      let extra: Record<string, unknown> | null = null;
      for (const k of Object.keys(n.attrs)) if (!known.attrs.has(k) && k !== XATTRS && n.attrs[k] != null) { (extra ??= {})[k] = n.attrs[k]; attrs.add(`${k} on ${n.type}`); }
      if (extra) { const kept: Record<string, unknown> = {}; for (const k of Object.keys(n.attrs)) if (!(k in extra)) kept[k] = n.attrs[k]; out = { ...out, attrs: { ...kept, [XATTRS]: { ...(n.attrs[XATTRS] ?? {}), ...extra } } }; }
    }
    if (n.content?.length) { const kids = n.content.map((c) => walk(c, known.inlineContent)); if (kids.some((k, i) => k !== n.content![i])) out = { ...out, content: kids }; }
    return out;
  };
  const out = walk(doc as PMNode, false);
  return { doc: out as T, report: { nodes: [...nodes], marks: [...marks], attrs: [...attrs] } };
}
/**
 * Inverse of `wrapUnknown`, applied to everything the editor emits: boxed nodes and marks come back verbatim, `xattrs` are spread
 * back into the attrs, and the reserved `xattrs` key itself never reaches the stored document. One pass; objects are only rebuilt
 * where something changes (the schema emits `xattrs: null` on every block, so attrs objects are rebuilt — text nodes are shared as is).
 */
export function unwrapUnknown<T extends PMNode | null | undefined>(doc: T): T {
  if (!doc || typeof doc !== "object") return doc;
  const walk = (n: PMNode): PMNode => {
    if (RESERVED.has(n.type) && n.attrs?.raw && typeof n.attrs.raw === "object") return n.attrs.raw as PMNode;
    let out = n;
    if (n.marks?.length && n.marks.some((m) => m.type === UNKNOWN_MARK)) out = { ...out, marks: n.marks.map((m) => (m.type === UNKNOWN_MARK && m.attrs?.raw ? (m.attrs.raw as Mark) : m)) };
    const a = n.attrs;
    if (a && XATTRS in a) {
      const next: Record<string, unknown> = {}; let any = false; for (const k in a) if (k !== XATTRS) { next[k] = a[k]; any = true; }
      const x = a[XATTRS]; if (x && typeof x === "object") for (const k in x) { next[k] = x[k]; any = true; }
      if (any) out = { ...out, attrs: next }; else { const { attrs: _drop, ...rest } = out; out = rest as PMNode; }
    }
    const c = n.content;
    if (c?.length) { let kids: PMNode[] | null = null; for (let i = 0; i < c.length; i++) { const k = walk(c[i]); if (k !== c[i] && !kids) kids = c.slice(0, i); if (kids) kids.push(k); } if (kids) out = { ...out, content: kids }; }
    return out;
  };
  return walk(doc as PMNode) as T;
}
export const reportIsEmpty = (r: UnknownReport) => !r.nodes.length && !r.marks.length && !r.attrs.length;
