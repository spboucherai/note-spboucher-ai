/** DOCX → HTML (mammoth, images stored as attachments) → Markdown (turndown) → page. */
import TurndownService from "turndown";
import { createAttachment, type ImportCtx } from "./pages";
import { importMarkdown } from "./markdown";

export async function docxToMarkdown(ctx: ImportCtx, buf: Buffer, pageId: string | null): Promise<{ markdown: string; images: number }> {
  const mammoth = await import("mammoth");
  let images = 0;
  const res = await mammoth.convertToHtml({ buffer: buf }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Code'] => pre:fresh"],
    convertImage: mammoth.images.imgElement(async (image) => { const b = await image.readAsBuffer(); const ext = image.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "png"; const a = await createAttachment(ctx, Buffer.from(b), `image-${++images}.${ext}`, image.contentType, pageId); return { src: `/api/files/${a.id}` }; }),
  });
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.keep(["sub", "sup"]);
  td.addRule("strike", { filter: ["s", "del", "strike" as any], replacement: (c) => `~~${c}~~` });
  td.addRule("table", { filter: "table", replacement: (_c, node) => { const rows = [...(node as HTMLElement).querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((td) => td.textContent?.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|") ?? "")); if (!rows.length) return ""; const w = Math.max(...rows.map((r) => r.length)); const pad = (r: string[]) => [...r, ...Array(w - r.length).fill("")]; return `\n\n| ${pad(rows[0]).join(" | ")} |\n| ${pad(rows[0]).map(() => "---").join(" | ")} |\n${rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`).join("\n")}\n\n`; } });
  return { markdown: td.turndown(res.value), images };
}
export async function importDocx(ctx: ImportCtx, buf: Buffer, opts: { filename: string; parentId?: string | null }) {
  const { markdown, images } = await docxToMarkdown(ctx, buf, null);
  const title = opts.filename.replace(/\.docx$/i, "");
  const firstH1 = markdown.match(/^#\s+(.+)$/m);
  const md = firstH1 && firstH1[1].trim().toLowerCase() === title.toLowerCase() ? markdown.replace(firstH1[0], "") : markdown;
  const page = await importMarkdown(ctx, `---\ntitle: ${JSON.stringify(title)}\n---\n${md}`, { filename: opts.filename, parentId: opts.parentId, section: "documents" });
  const original = await createAttachment(ctx, buf, opts.filename, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", page.id);
  return { page, images, attachmentId: original.id };
}
