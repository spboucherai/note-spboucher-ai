/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/graph/backlinks.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
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

/** Backlinks explorer: incoming-link counts, unlinked-mention finder (plain SQL strpos over pages.plain_text), link-it / dismiss. */
import { eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getPage, updatePage } from "@/lib/pages/service";
import type { PMNode } from "@/lib/editor/text";
import { HttpError } from "@/lib/errors";
import type { BacklinkRow, UnlinkedMention } from "./types";

const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const DISMISS_KEY = "backlinks.dismissed";

/** Pages ranked by incoming links (one query). */
export async function backlinkStats(wsId: string, opts: { limit?: number; q?: string } = {}): Promise<BacklinkRow[]> {
  const q = opts.q?.trim() ? dsql`and p.title ilike ${"%" + opts.q!.trim() + "%"}` : dsql``;
  const r = await rows<any>(dsql`
    select p.id, p.title, p.icon, p.type, p.section, p.updated_at,
      (select count(*)::int from links l join pages f on f.id = l.from_page_id and f.deleted_at is null where l.to_page_id = p.id) as incoming,
      (select count(*)::int from links l join pages t on t.id = l.to_page_id and t.deleted_at is null where l.from_page_id = p.id) as outgoing,
      (select count(*)::int from knowledge_edges k where k.kind = 'ai_suggested' and k.status = 'suggested' and (k.from_id = p.id or k.to_id = p.id) and not exists (select 1 from links l where (l.from_page_id = k.from_id and l.to_page_id = k.to_id) or (l.from_page_id = k.to_id and l.to_page_id = k.from_id))) as suggested
    from pages p where p.workspace_id = ${wsId} and p.deleted_at is null ${q}
    order by incoming desc, outgoing desc, p.updated_at desc limit ${opts.limit ?? 300}`);
  return r.map((x) => ({ id: x.id, title: x.title || "Untitled", icon: x.icon, type: x.type, section: x.section, updatedAt: new Date(x.updated_at).toISOString(), incoming: x.incoming, outgoing: x.outgoing, suggested: x.suggested }));
}

export async function dismissedKeys(): Promise<string[]> {
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.key, DISMISS_KEY));
  return Array.isArray(s?.value) ? (s!.value as string[]) : [];
}
export async function dismissMention(fromId: string, toId: string, undo = false) {
  const key = `${fromId}:${toId}`; const cur = new Set(await dismissedKeys()); if (undo) cur.delete(key); else cur.add(key);
  const value = [...cur].slice(-5000);
  await db.insert(schema.settings).values({ key: DISMISS_KEY, value, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  return value;
}

/** Pages whose text contains another page's exact title (case-insensitive) without linking to it. */
export async function unlinkedMentions(wsId: string, opts: { limit?: number; pageId?: string | null; includeDismissed?: boolean } = {}): Promise<UnlinkedMention[]> {
  const scope = opts.pageId ? dsql`and (t.id = ${opts.pageId} or m.id = ${opts.pageId})` : dsql``;
  const r = await rows<any>(dsql`
    select m.id as from_id, m.title as from_title, m.icon as from_icon, t.id as to_id, t.title as to_title, t.icon as to_icon,
      substr(m.plain_text, greatest(strpos(lower(m.plain_text), lower(t.title)) - 70, 1), 200) as excerpt
    from pages t join pages m on m.workspace_id = t.workspace_id and m.id <> t.id and m.deleted_at is null
      and strpos(lower(m.plain_text), lower(t.title)) > 0
    where t.workspace_id = ${wsId} and t.deleted_at is null and length(t.title) >= 4 and t.title <> 'Untitled' ${scope}
      and not exists (select 1 from links l where l.from_page_id = m.id and l.to_page_id = t.id)
    order by t.title, m.updated_at desc limit ${opts.limit ?? 400}`);
  const dismissed = opts.includeDismissed ? new Set<string>() : new Set(await dismissedKeys());
  return r.map((x) => ({ fromId: x.from_id, fromTitle: x.from_title || "Untitled", fromIcon: x.from_icon, toId: x.to_id, toTitle: x.to_title, toIcon: x.to_icon, excerpt: String(x.excerpt ?? "").replace(/\s+/g, " ").trim(), key: `${x.from_id}:${x.to_id}` })).filter((m) => !dismissed.has(m.key));
}

/** "Link it": append a paragraph with a mention node to the mentioning page (links row is created by updatePage). */
export async function linkMention(wsId: string, fromId: string, toId: string) {
  if (fromId === toId) throw new HttpError(400, "A page cannot link to itself");
  const [from, to] = await Promise.all([getPage(wsId, fromId), getPage(wsId, toId)]);
  const doc = (from.content as PMNode) ?? { type: "doc", content: [] };
  const para: PMNode = { type: "paragraph", content: [{ type: "text", text: "See also " }, { type: "mention", attrs: { id: to.id, label: to.title } }] };
  const content: PMNode = { ...doc, type: "doc", content: [...(doc.content ?? []), para] };
  await updatePage(wsId, fromId, { content }, { versionReason: "backlink" });
  await dismissMention(fromId, toId, true);
  return { fromId, toId };
}
