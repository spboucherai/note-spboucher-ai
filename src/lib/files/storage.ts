import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export async function storeFile(buf: Buffer, originalName: string) {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ext = (originalName.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? "").toLowerCase();
  const rel = path.join(sha256.slice(0, 2), sha256.slice(2, 4), sha256 + ext);
  const abs = path.join(UPLOAD_DIR, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try { await fs.access(abs); } catch { await fs.writeFile(abs, buf); }
  return { sha256, storagePath: rel };
}
export const absPath = (rel: string) => { const p = path.join(UPLOAD_DIR, rel); if (!p.startsWith(UPLOAD_DIR)) throw new Error("bad path"); return p; };
