/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/docx.ts
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

/** DOCX → HTML (mammoth, images stored as attachments) → Markdown (turndown) → page. */
import TurndownService from "turndown";
import { createAttachment, tick, type ImportCtx } from "./pages";
import { importMarkdown } from "./markdown";

export async function docxToMarkdown(ctx: ImportCtx, buf: Buffer, pageId: string | null): Promise<{ markdown: string; images: number }> {
  const mammoth = await import("mammoth");
  let images = 0;
  const res = await mammoth.convertToHtml({ buffer: buf }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Code'] => pre:fresh"],
    convertImage: mammoth.images.imgElement(async (image) => { const b = await image.readAsBuffer(); const ext = image.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "png"; const n = ++images; const a = await createAttachment(ctx, Buffer.from(b), `image-${n}.${ext}`, image.contentType, pageId, `docx-image-${n}`); return { src: `/api/files/${a.id}` }; }),
  });
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.keep(["sub", "sup"]);
  td.addRule("strike", { filter: ["s", "del", "strike" as any], replacement: (c) => `~~${c}~~` });
  td.addRule("table", { filter: "table", replacement: (_c, node) => { const rows = [...(node as HTMLElement).querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((td) => td.textContent?.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|") ?? "")); if (!rows.length) return ""; const w = Math.max(...rows.map((r) => r.length)); const pad = (r: string[]) => [...r, ...Array(w - r.length).fill("")]; return `\n\n| ${pad(rows[0]).join(" | ")} |\n| ${pad(rows[0]).map(() => "---").join(" | ")} |\n${rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`).join("\n")}\n\n`; } });
  // mammoth reports what it could not map (unknown styles, unsupported elements): surface the count instead of dropping it silently
  const warnings = (res.messages ?? []).filter((m) => m.type === "warning" || m.type === "error").length;
  if (warnings) ctx.stats.skipped.push(`${warnings} Word element(s) or style(s) had no equivalent and were simplified (fonts, colours, footnotes, comments and tracked changes are not imported)`);
  return { markdown: td.turndown(res.value), images };
}
export async function importDocx(ctx: ImportCtx, buf: Buffer, opts: { filename: string; parentId?: string | null }) {
  const { markdown, images } = await docxToMarkdown(ctx, buf, null);
  const title = opts.filename.replace(/\.docx$/i, "");
  const firstH1 = markdown.match(/^#\s+(.+)$/m);
  const md = firstH1 && firstH1[1].trim().toLowerCase() === title.toLowerCase() ? markdown.replace(firstH1[0], "") : markdown;
  await tick(ctx, "Document converted");
  // duplicates of a .docx are recognised by the file itself (sha256) in runImport, not by the converted text
  const page = await importMarkdown({ ...ctx, existing: null }, `---\ntitle: ${JSON.stringify(title)}\n---\n${md}`, { key: "docx", filename: opts.filename, parentId: opts.parentId, section: "documents" });
  const original = await createAttachment(ctx, buf, opts.filename, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", page.id, "docx-original");
  await tick(ctx, `Page ${page.title}`);
  return { page, images, attachmentId: original.id };
}
