/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/databases/templates.ts
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

/** Built-in database templates: applied onto an existing (empty) database. */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import type { PropertyType, PropertyConfig, ViewType, ViewConfig, SelectOption } from "./types";
import { ensureDatabase, createProperty, createView } from "./service";
import { loadProps } from "./query";

type TProp = { name: string; type: PropertyType; config?: PropertyConfig; width?: number };
type TView = { name: string; type: ViewType; config?: (ids: Record<string, string>) => ViewConfig };
export interface Template { id: string; name: string; icon: string; description: string; title: string; properties: TProp[]; views: TView[] }
const opt = (names: string[], colors: SelectOption["color"][] = []): SelectOption[] => names.map((name, i) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), name, color: colors[i] ?? "gray" }));
const status = (): SelectOption[] => [{ id: "todo", name: "Not started", color: "gray", group: "todo" }, { id: "doing", name: "In progress", color: "blue", group: "in_progress" }, { id: "done", name: "Done", color: "green", group: "done" }];

export const TEMPLATES: Template[] = [
  { id: "research-papers", name: "Research papers", icon: "📚", description: "Track papers you read, with status, domain, venue, DOI and AI-generated notes.", title: "Paper", properties: [
    { name: "Status", type: "status", config: { options: [{ id: "toread", name: "To read", color: "gray", group: "todo" }, { id: "reading", name: "Reading", color: "blue", group: "in_progress" }, { id: "read", name: "Read", color: "green", group: "done" }, { id: "cited", name: "Cited", color: "purple", group: "done" }] } },
    { name: "Domain", type: "multi_select", config: { options: opt(["Real estate", "Finance", "Machine learning", "LLM agents", "Econometrics", "Urban economics"], ["green", "blue", "purple", "pink", "orange", "teal"]) } },
    { name: "AI model", type: "select", config: { options: opt(["Claude", "GPT", "Gemini", "Llama", "Mistral", "Other"], ["purple", "green", "blue", "orange", "yellow", "gray"]) } },
    { name: "Year", type: "number", config: { format: "integer" }, width: 90 },
    { name: "Venue", type: "text" },
    { name: "DOI", type: "url" },
    { name: "Notes", type: "ai", config: { prompt: "Write a 3-sentence summary of what this paper is likely about and why it matters, based on its title, venue and domain. If the information is insufficient, say what is missing." } },
    { name: "Added", type: "created_time", width: 130 },
  ], views: [{ name: "All papers", type: "table" }, { name: "By status", type: "board", config: (ids) => ({ groupBy: ids.Status }) }, { name: "Gallery", type: "gallery" }] },
  { id: "tasks", name: "Tasks", icon: "✅", description: "Simple task tracker with priority, due date, project and a board by status.", title: "Task", properties: [
    { name: "Status", type: "status", config: { options: status() } },
    { name: "Priority", type: "select", config: { options: opt(["Low", "Medium", "High", "Urgent"], ["gray", "blue", "orange", "red"]) }, width: 110 },
    { name: "Due", type: "date", width: 130 },
    { name: "Project", type: "select", config: { options: [] } },
    { name: "Done", type: "checkbox", width: 70 },
    { name: "Days left", type: "formula", config: { expression: 'if(empty(prop("Due")), "", dateDiff(prop("Due"), today(), "days"))' }, width: 100 },
  ], views: [{ name: "All tasks", type: "table", config: (ids) => ({ sorts: [{ property: ids.Due, dir: "asc" }] }) }, { name: "Board", type: "board", config: (ids) => ({ groupBy: ids.Status }) }, { name: "Calendar", type: "calendar", config: (ids) => ({ dateProperty: ids.Due }) }, { name: "Timeline", type: "timeline", config: (ids) => ({ startProperty: ids.Due, endProperty: ids.Due }) }] },
  { id: "reading-list", name: "Reading list", icon: "📖", description: "Books, articles and links to read, with type, rating and a short AI pitch.", title: "Title", properties: [
    { name: "Type", type: "select", config: { options: opt(["Book", "Article", "Paper", "Video", "Podcast", "Link"], ["blue", "green", "purple", "orange", "pink", "gray"]) }, width: 110 },
    { name: "Status", type: "status", config: { options: [{ id: "want", name: "Want to read", color: "gray", group: "todo" }, { id: "reading", name: "Reading", color: "blue", group: "in_progress" }, { id: "finished", name: "Finished", color: "green", group: "done" }] } },
    { name: "Author", type: "text" },
    { name: "Link", type: "url" },
    { name: "Rating", type: "number", config: { format: "integer" }, width: 90 },
    { name: "Tags", type: "multi_select", config: { options: [] } },
    { name: "Finished on", type: "date", width: 130 },
    { name: "Pitch", type: "ai", config: { prompt: "In one sentence, explain why this item could be worth reading for a professor of real-estate finance who does AI research." } },
  ], views: [{ name: "List", type: "list" }, { name: "Table", type: "table" }, { name: "Gallery", type: "gallery" }, { name: "By status", type: "board", config: (ids) => ({ groupBy: ids.Status }) }] },
];
export async function applyTemplate(wsId: string, dbId: string, templateId: string) {
  const t = TEMPLATES.find((x) => x.id === templateId); if (!t) throw new HttpError(400, "Unknown template");
  const d = await ensureDatabase(wsId, dbId); const existing = await loadProps(d.id); const ids: Record<string, string> = {};
  const tp = existing.find((p) => p.type === "title"); if (tp) { await db.update(schema.databaseProperties).set({ name: t.title }).where(eq(schema.databaseProperties.id, tp.id)); ids[t.title] = tp.id; }
  for (const p of t.properties) { const ex = existing.find((x) => x.name.toLowerCase() === p.name.toLowerCase()); if (ex) { ids[p.name] = ex.id; continue; } const np = await createProperty(wsId, d.id, { name: p.name, type: p.type, config: p.config, width: p.width ?? null }); ids[p.name] = np.id; }
  const views = await db.select().from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, d.id));
  const first = t.views[0]; const defaultView = views.find((v) => v.isDefault) ?? views[0];
  if (defaultView && views.length === 1 && defaultView.type === first.type) await db.update(schema.databaseViews).set({ name: first.name, config: first.config?.(ids) ?? {} }).where(eq(schema.databaseViews.id, defaultView.id));
  else await createView(wsId, d.id, { name: first.name, type: first.type, config: first.config?.(ids) });
  for (const v of t.views.slice(1)) await createView(wsId, d.id, { name: v.name, type: v.type, config: v.config?.(ids) });
  if (!d.icon) { await db.update(schema.pages).set({ icon: t.icon }).where(eq(schema.pages.id, d.pageId)); await db.update(schema.databases).set({ icon: t.icon }).where(eq(schema.databases.id, d.id)); }
  return { applied: t.id, properties: Object.keys(ids).length };
}
export const templateSummaries = () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, icon: t.icon, description: t.description, properties: [t.title, ...t.properties.map((p) => p.name)] }));
