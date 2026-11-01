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
