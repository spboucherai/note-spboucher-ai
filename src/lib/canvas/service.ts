/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/canvas/service.ts
 * Description      : canvas storage (SPEC §3.4). A canvas is a page of type
 *                    `canvas` plus one row in `canvases`; it is saved with the
 *                    same optimistic model as a page (`baseVersion` →
 *                    compare-and-set in one statement → 409 with the server
 *                    copy). Clients merge by node / edge id when both sides
 *                    changed different ids. The change feed (`rev`, tombstone)
 *                    comes from the triggers of 0003.
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

import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { sameJson } from "@/lib/same-json";
import { recordCoalesced } from "@/lib/events/service";
import { canvasProblem, canvasRefs, EMPTY_CANVAS, type CanvasData } from "./format";
import { canvasText } from "./export";
import { wordCount } from "@/lib/editor/text";
import { enqueue, QUEUES } from "@/lib/jobs";

const C = schema.canvases; const P = schema.pages;
export interface CanvasOut { pageId: string; title: string; data: CanvasData; version: number; rev: number; updatedAt: Date }
async function canvasPage(wsId: string, pageId: string, opts: { includeDeleted?: boolean } = {}) {
  const [p] = await db.select({ id: P.id, title: P.title, type: P.type, deletedAt: P.deletedAt }).from(P).where(and(eq(P.id, pageId), eq(P.workspaceId, wsId)));
  if (!p || (p.deletedAt && !opts.includeDeleted)) throw new HttpError(404, "Canvas not found", "not_found");
  if (p.type !== "canvas") throw new HttpError(404, "This page is not a canvas", "not_canvas");
  return p;
}
/** The canvas of a page of type `canvas` (readable in the trash too). A page that has no row yet (type changed by hand, restored backup) gets an empty one. */
export async function getCanvas(wsId: string, pageId: string): Promise<CanvasOut> {
  const p = await canvasPage(wsId, pageId, { includeDeleted: true });
  let [c] = await db.select().from(C).where(eq(C.pageId, pageId));
  if (!c) { await db.insert(C).values({ pageId, workspaceId: wsId, data: EMPTY_CANVAS() }).onConflictDoNothing(); [c] = await db.select().from(C).where(eq(C.pageId, pageId)); }
  return { pageId, title: p.title, data: c.data as CanvasData, version: c.version, rev: c.rev, updatedAt: c.updatedAt };
}
export const canvasConflict = (c: CanvasOut) => ({ server: { version: c.version, data: c.data, updatedAt: c.updatedAt } });
/**
 * Save. The write happens only if the row is still at `baseVersion` (one statement); otherwise 409 `conflict` with the server copy and
 * nothing is written. Saving exactly what is stored is a no-op (same version, no event). Journal: `canvas.edited`, coalesced like
 * `page.edited` (at most one per canvas per 10 minutes).
 */
export async function putCanvas(wsId: string, pageId: string, data: unknown, baseVersion: number): Promise<{ version: number; rev: number; updatedAt: Date; unchanged: boolean }> {
  const problem = canvasProblem(data); if (problem) throw new HttpError(/too large|at most \d+ (nodes|edges)/.test(problem) ? 413 : 400, `Invalid canvas: ${problem}`, "bad_canvas");
  const p = await canvasPage(wsId, pageId); const cur = await getCanvas(wsId, pageId);
  if (cur.version !== baseVersion) throw new HttpError(409, "This canvas was changed in another session", "conflict", canvasConflict(cur));
  if (sameJson(cur.data, data)) return { version: cur.version, rev: cur.rev, updatedAt: cur.updatedAt, unchanged: true };
  const d = data as CanvasData; const refs = canvasRefs(d);
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(C).set({ data: d, version: dsql`${C.version} + 1`, updatedAt: new Date() }).where(and(eq(C.pageId, pageId), eq(C.version, baseVersion))).returning({ version: C.version, rev: C.rev, updatedAt: C.updatedAt });
    if (!row) return null;
    // page cards make the canvas a backlink of those pages (links kind `canvas`; the document links of the page are untouched)
    await tx.delete(schema.links).where(and(eq(schema.links.fromPageId, pageId), eq(schema.links.kind, "canvas")));
    const targets = refs.pages.filter((id) => id !== pageId);
    if (targets.length) { const valid = await tx.select({ id: P.id }).from(P).where(and(eq(P.workspaceId, wsId), inArray(P.id, targets))); if (valid.length) await tx.insert(schema.links).values(valid.map((v) => ({ fromPageId: pageId, toPageId: v.id, kind: "canvas" }))).onConflictDoNothing(); }
    // the canvas page shows up in "recent" and moves in the page feed; the text of its cards (text, LaTeX, addresses, edge labels) becomes
    // the page's plain text, so full-text search (`tsv`) finds a canvas by what is written on it
    const plain = canvasText(d);
    await tx.update(P).set({ updatedAt: new Date(), plainText: plain, wordCount: wordCount(plain) }).where(eq(P.id, pageId));
    return row;
  });
  if (!saved) throw new HttpError(409, "This canvas was changed in another session", "conflict", canvasConflict(await getCanvas(wsId, pageId)));
  // semantic index of the page (same queue and throttle as a page save); never fails the save
  await enqueue(QUEUES.index, { sourceType: "page", sourceId: pageId, workspaceId: wsId }, { singletonKey: `page:${pageId}`, singletonSeconds: 20, singletonNextSlot: true }).catch(() => {});
  await recordCoalesced({ workspaceId: wsId, kind: "canvas.edited", pageId, entityKind: "canvas", entityId: pageId, summary: p.title, data: { version: saved.version, nodes: d.nodes.length, edges: d.edges.length } });
  return { ...saved, unchanged: false };
}
