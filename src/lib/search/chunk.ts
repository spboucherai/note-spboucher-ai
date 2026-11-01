import { createHash } from "node:crypto";
import { docBlocks, type PMNode } from "@/lib/editor/text";
export interface Chunk { ordinal: number; heading: string | null; blockId: string | null; content: string; tokenCount: number; contentHash: string }
export const approxTokens = (s: string) => Math.ceil(s.length / 3.6);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Document-aware chunking: follows headings/blocks, targets ~350 tokens, 60-token overlap for long runs. */
export function chunkDocument(title: string, doc: PMNode | null | undefined, opts = { target: 350, max: 500, overlap: 60 }): Chunk[] {
  const blocks = docBlocks(doc); const chunks: Chunk[] = [];
  let buf: string[] = []; let bufTok = 0; let heading: string | null = null; let blockId: string | null = null;
  const flush = () => { if (!buf.length) return; const content = buf.join("\n").trim(); if (content) chunks.push({ ordinal: chunks.length, heading, blockId, content, tokenCount: approxTokens(content), contentHash: sha(content) }); buf = []; bufTok = 0; };
  for (const b of blocks) {
    if (b.type === "heading") { flush(); heading = b.text; blockId = b.id; continue; }
    const t = approxTokens(b.text);
    if (t > opts.max) { flush(); chunkLongText(b.text, opts).forEach((piece) => { chunks.push({ ordinal: chunks.length, heading, blockId: b.id, content: piece, tokenCount: approxTokens(piece), contentHash: sha(piece) }); }); continue; }
    if (bufTok + t > opts.target && buf.length) flush();
    if (!buf.length) blockId = b.id;
    buf.push(b.text); bufTok += t;
  }
  flush();
  if (!chunks.length && title) chunks.push({ ordinal: 0, heading: null, blockId: null, content: title, tokenCount: approxTokens(title), contentHash: sha(title) });
  return chunks;
}
export function chunkLongText(text: string, opts = { target: 350, max: 500, overlap: 60 }): string[] {
  const sentences = text.split(/(?<=[.!?。])\s+|\n+/).filter(Boolean); const out: string[] = []; let cur: string[] = []; let tok = 0;
  for (const s of sentences) { const t = approxTokens(s); if (tok + t > opts.target && cur.length) { out.push(cur.join(" ")); const keep: string[] = []; let kt = 0; for (let i = cur.length - 1; i >= 0 && kt < opts.overlap; i--) { keep.unshift(cur[i]); kt += approxTokens(cur[i]); } cur = keep; tok = kt; } cur.push(s); tok += t; }
  if (cur.length) out.push(cur.join(" ")); return out;
}
export function chunkPlainText(text: string): Chunk[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean); const chunks: Chunk[] = []; let buf: string[] = []; let tok = 0;
  const flush = () => { if (!buf.length) return; const c = buf.join("\n\n"); chunks.push({ ordinal: chunks.length, heading: null, blockId: null, content: c, tokenCount: approxTokens(c), contentHash: sha(c) }); buf = []; tok = 0; };
  for (const p of paras) { const t = approxTokens(p); if (t > 500) { flush(); chunkLongText(p).forEach((x) => chunks.push({ ordinal: chunks.length, heading: null, blockId: null, content: x, tokenCount: approxTokens(x), contentHash: sha(x) })); continue; } if (tok + t > 350 && buf.length) flush(); buf.push(p); tok += t; }
  flush(); return chunks;
}
