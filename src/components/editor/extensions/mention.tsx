/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/extensions/mention.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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

"use client";
import Mention from "@tiptap/extension-mention";
import { FileText, Database, FlaskConical, Plus } from "lucide-react";
import { SuggestionList, makeRenderer, type Item } from "./suggestion-ui";

async function searchPages(q: string): Promise<Item[]> {
  const r = await fetch(`/api/search?mode=quick&q=${encodeURIComponent(q)}&limit=8`).then((x) => x.json()).catch(() => []);
  const items: Item[] = (Array.isArray(r) ? r : []).map((p: any) => ({ id: p.id, title: p.title, hint: p.section, icon: p.icon ? <span>{p.icon}</span> : p.type === "database" ? <Database /> : p.type === "research" ? <FlaskConical /> : <FileText />, data: { id: p.id, label: p.title } }));
  if (q.trim()) items.push({ id: "__new", title: `Create page “${q.trim()}”`, icon: <Plus />, data: { create: q.trim() } });
  return items;
}
export const PageMention = Mention.configure({
  HTMLAttributes: { class: "mention" },
  renderHTML({ options, node }) { return ["a", { class: "mention", href: `/p/${node.attrs.id}`, "data-type": "mention", "data-id": node.attrs.id, "data-label": node.attrs.label }, `${options.suggestion.char ?? "@"}${node.attrs.label ?? node.attrs.id}`]; },
  renderText({ node }) { return `@${node.attrs.label ?? node.attrs.id}`; },
  suggestion: {
    char: "@", allowSpaces: true,
    items: ({ query }) => searchPages(query),
    command: async ({ editor, range, props }: any) => {
      let { id, label, create } = props.data ?? props;
      if (create) { const p = await fetch("/api/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: create }) }).then((x) => x.json()); id = p.id; label = p.title; }
      editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id, label } }, { type: "text", text: " " }]).run();
    },
    render: makeRenderer(SuggestionList, { empty: "No page found" }),
  },
});
