/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/pages/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { createPage, findPageAnyState } from "@/lib/pages/service";
import { db, schema } from "@/db";
import { and, desc, eq, isNull, isNotNull, sql as dsql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { assertDoc } from "@/lib/editor/validate";
import { recordEvent } from "@/lib/events/service";
import { parseOffset } from "@/lib/paging";

/**
 * GET ?view=recent|pinned|trash|archived|section:<name>|children:<id>&limit=<1..100, default 20>&offset=<0..100000, default 0>
 * `offset` (optional, additive) pages through a view with the same ordering; the answer stays a plain array, and the header
 * `x-next-offset` is set when the page came back full (there may be more rows).
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url); const view = u.searchParams.get("view") ?? "recent"; const limit = Math.min(100, Number(u.searchParams.get("limit") ?? 20));
  const offset = parseOffset(u.searchParams.get("offset")); if (offset === null) throw new HttpError(400, "offset must be an integer between 0 and 100000", "bad_offset");
  const out = <T,>(rows: T[]) => Response.json(rows, rows.length && rows.length === limit ? { headers: { "x-next-offset": String(offset + rows.length) } } : undefined);
  const base = [eq(schema.pages.workspaceId, ws.id)];
  const cols = { id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, type: schema.pages.type, parentId: schema.pages.parentId, updatedAt: schema.pages.updatedAt, lastOpenedAt: schema.pages.lastOpenedAt, deletedAt: schema.pages.deletedAt, wordCount: schema.pages.wordCount, pinned: schema.pages.pinned, properties: schema.pages.properties, databaseId: schema.pages.databaseId };
  if (view === "trash") return out(await db.select(cols).from(schema.pages).where(and(...base, isNotNull(schema.pages.deletedAt))).orderBy(desc(schema.pages.deletedAt), desc(schema.pages.id)).limit(limit).offset(offset));
  if (view === "archived") return out(await db.select(cols).from(schema.pages).where(and(...base, isNull(schema.pages.deletedAt), eq(schema.pages.archived, true))).orderBy(desc(schema.pages.updatedAt), desc(schema.pages.id)).limit(limit).offset(offset));
  const where = [...base, isNull(schema.pages.deletedAt), eq(schema.pages.archived, false)];
  if (view === "recent") where.push(isNull(schema.pages.inboxAt));
  if (view === "pinned") where.push(eq(schema.pages.pinned, true));
  if (view.startsWith("section:")) where.push(eq(schema.pages.section, view.slice(8)), isNull(schema.pages.databaseId));
  if (view.startsWith("children:")) where.push(eq(schema.pages.parentId, uuid.parse(view.slice(9))));
  const order = view === "recent" ? dsql`greatest(coalesce(last_opened_at, 'epoch'), updated_at) desc` : view.startsWith("children:") ? dsql`position asc` : desc(schema.pages.updatedAt);
  return out(await db.select(cols).from(schema.pages).where(and(...where)).orderBy(order).limit(limit).offset(offset));
});
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ id: z.string().uuid().optional(), title: z.string().max(500).optional(), parentId: z.string().uuid().nullable().optional(), section: z.enum(["notes", "documents", "databases", "projects", "research"]).optional(), type: z.enum(["page", "database", "research", "canvas"]).optional(), content: z.any().optional(), icon: z.string().max(16).nullable().optional(), properties: z.record(z.string(), z.unknown()).optional(),
    // 3.0 (offline-first capture): a note captured offline by a native client is created through this route under its client id and
    // must land in the server inbox — `inboxAt` (ISO date) or `inbox: true` (now), and `captureKind` (open string: note, link, photo…)
    inboxAt: z.string().max(40).nullable().optional(), inbox: z.boolean().optional(), captureKind: z.string().trim().min(1).max(32).nullable().optional() }));
  if (b.content !== undefined) assertDoc(b.content);
  let inboxAt: Date | null = null;
  if (b.inboxAt) { inboxAt = new Date(b.inboxAt); if (isNaN(inboxAt.getTime())) throw new HttpError(400, "Invalid inboxAt", "bad_request"); } else if (b.inbox) inboxAt = new Date();
  if (b.captureKind && !inboxAt) inboxAt = new Date(); // a capture kind means a capture: it goes to the inbox
  // A native client creates notes offline under its own UUID and sends them later, possibly twice (retry after a lost answer): the
  // second time the stored page is returned as it is — never a duplicate, never an overwrite.
  if (b.id) { const existing = await findPageAnyState(ws.id, b.id); if (existing) return Response.json(existing, { status: 200, headers: { "x-existing": "1" } }); }
  if (b.parentId && !(await findPageAnyState(ws.id, b.parentId))) b.parentId = null; // parent purged meanwhile: the note is kept, at the top level
  const { inboxAt: _a, inbox: _b, captureKind, ...rest } = b; void _a; void _b;
  const p = await createPage(ws.id, { ...rest, inboxAt, captureKind: inboxAt ? captureKind ?? "note" : null });
  if (p.inboxAt) await recordEvent(db, { workspaceId: ws.id, kind: "capture.created", pageId: p.id, summary: p.title, data: { kind: p.captureKind ?? "note", attachments: 0, via: "pages" } }); // same journal entry as POST /api/capture
  await audit(user.id, p.inboxAt ? "inbox.capture" : "page.create", { type: "page", id: p.id }, p.inboxAt ? { kind: p.captureKind, attachments: 0 } : { title: p.title });
  return Response.json(p, { status: 201 });
});
