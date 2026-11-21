/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/files/extract.ts
 * Module           : lib
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

/** Text extraction for attachments (PDF, DOCX, Markdown/TXT/CSV). Returns null for unsupported types. */
export async function extractText(buf: Buffer, mime: string, filename: string): Promise<{ text: string; pages?: number } | null> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  try {
    if (mime === "application/pdf" || ext === "pdf") { const { PDFParse } = await import("pdf-parse"); const p = new PDFParse({ data: new Uint8Array(buf) }); const r = await p.getText(); await p.destroy().catch(() => {}); return { text: r.text ?? "", pages: r.total ?? undefined }; }
    if (ext === "docx" || mime.includes("wordprocessingml")) { const mammoth = await import("mammoth"); const r = await mammoth.extractRawText({ buffer: buf }); return { text: r.value }; }
    if (/^text\//.test(mime) || ["md", "markdown", "txt", "csv", "json", "bib", "tex", "py", "ts", "js", "r", "sql"].includes(ext)) return { text: buf.toString("utf8").slice(0, 2_000_000) };
  } catch (e) { console.error("extract failed", filename, e); }
  return null;
}
