/**
 * Markdown → page. Front-matter → title/icon/tags/properties; `[[Wiki links]]` → mentions when the title (or archive path) is
 * known, otherwise plain text; `![img](relative)` and `[file](relative)` → attachments through `resolveFile`.
 */
import { markdownToDoc } from "@/lib/editor/markdown-client";
import type { PMNode } from "@/lib/editor/text";
import { docText } from "@/lib/editor/text";
import { createPage, updatePage, findDuplicatePage, getPageById, type ImportCtx, type Page } from "./pages";

export interface FrontMatter { data: Record<string, unknown>; body: string }
const yamlValue = (raw: string): unknown => {
  const s = raw.trim();
  if (s === "" ) return "";
  if (s === "null" || s === "~") return null; if (s === "true") return true; if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\[.*\]$/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1).split(",").map((x) => yamlValue(x)).filter((x) => x !== ""); } }
  if (/^\{.*\}$/.test(s)) { try { return JSON.parse(s); } catch { return s; } }
  if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s;
};
/** Minimal YAML subset: `key: scalar`, `key: [a, b]`, block lists (`- x`) and one level of nested maps. */
export function parseFrontMatter(src: string): FrontMatter {
  const m = src.replace(/^﻿/, "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: src };
  const data: Record<string, unknown> = {}; const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]; i++;
    const kv = line.match(/^([A-Za-z0-9_ .-]+?):\s*(.*)$/); if (!kv || /^\s/.test(line)) continue;
    const key = kv[1].trim(); const rest = kv[2];
    if (rest !== "") { data[key] = yamlValue(rest); continue; }
    // block: list or nested map
    const list: unknown[] = []; const map: Record<string, unknown> = {}; let isList = false, isMap = false;
    while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === "")) {
      const l = lines[i]; i++; if (!l.trim()) continue;
      const li = l.match(/^\s+-\s*(.*)$/); if (li) { isList = true; list.push(yamlValue(li[1])); continue; }
      const mk = l.match(/^\s+([A-Za-z0-9_ .-]+?):\s*(.*)$/); if (mk) { isMap = true; map[mk[1].trim()] = yamlValue(mk[2]); }
    }
    data[key] = isList ? list : isMap ? map : null;
  }
  return { data, body: src.slice(m[0].length) };
}
/** Notion-style header: `# Title` then `Key: value` lines until the first blank line. */
export function parseNotionHeader(body: string): { title: string | null; props: Record<string, string>; body: string } {
  let rest = body.replace(/^\s*\n/, ""); let title: string | null = null;
  const h = rest.match(/^#\s+(.+?)\s*\r?\n/); if (h) { title = h[1].trim(); rest = rest.slice(h[0].length); }
  const props: Record<string, string> = {};
  const lines = rest.split(/\r?\n/); let j = 0;
  while (j < lines.length && /^[A-Za-z][A-Za-z0-9 _()/#&-]{0,60}:\s/.test(lines[j]) && !/^https?:/i.test(lines[j])) { const mm = lines[j].match(/^([^:]+):\s+(.*)$/); if (!mm) break; props[mm[1].trim()] = mm[2].trim(); j++; }
  if (j > 0 && (j >= lines.length || lines[j].trim() === "")) rest = lines.slice(j).join("\n"); else Object.keys(props).forEach((k) => delete props[k]);
  return { title, props, body: rest.replace(/^\s*\n/, "") };
}

export type FileResolver = (ref: string) => Promise<{ id: string; filename: string; mime: string; size: number } | null>;
export interface MdOptions { resolveFile?: FileResolver; resolvePath?: (ref: string) => string | null }
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const TOKEN_RE = /⦃(img|ref):(\d+)⦄/g;
const tok = (k: string, n: number) => `⦃${k}:${n}⦄`;

/** Markdown → ProseMirror doc, resolving images/attachments and wiki links. */
export async function mdToDoc(ctx: ImportCtx, md: string, opts: MdOptions = {}): Promise<PMNode> {
  const imgs: { alt: string; src: string }[] = []; const refs: { target: string; alias: string | null }[] = [];
  // only transform outside fenced code blocks
  const parts = md.replace(/\r\n/g, "\n").split(/(^```[\s\S]*?^```$)/m);
  const pre = parts.map((seg, i) => (i % 2 ? seg : seg.replace(IMG_RE, (_m, alt, src) => { imgs.push({ alt, src }); return tok("img", imgs.length - 1); }).replace(WIKI_RE, (_m, t, a) => { refs.push({ target: t.trim(), alias: a?.trim() ?? null }); return tok("ref", refs.length - 1); }))).join("");
  const nodes = markdownToDoc(pre);
  const files = new Map<number, { src: string; alt: string } | null>(); const links = new Map<string, string>();
  const resolveSrc = async (src: string): Promise<string | null> => {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("/api/files/")) return src;
    if (!opts.resolveFile) return null;
    const f = await opts.resolveFile(safeDecode(src)); return f ? `/api/files/${f.id}` : null;
  };
  for (let i = 0; i < imgs.length; i++) { const s = await resolveSrc(imgs[i].src); files.set(i, s ? { src: s, alt: imgs[i].alt } : null); }
  const resolveRef = (r: { target: string; alias: string | null }) => { const id = ctx.titles.get(r.target.toLowerCase()) ?? opts.resolvePath?.(r.target) ?? opts.resolvePath?.(r.target + ".md") ?? null; return { id, label: r.alias ?? r.target }; };
  const resolveHref = async (href: string): Promise<string> => {
    if (links.has(href)) return links.get(href)!;
    let out = href;
    if (!/^(https?:|mailto:|#|\/|data:)/i.test(href)) {
      const dec = safeDecode(href.replace(/#.*$/, ""));
      const pid = opts.resolvePath?.(dec); if (pid) out = `/p/${pid}`;
      else if (opts.resolveFile && !/\.md$/i.test(dec)) { const f = await opts.resolveFile(dec); if (f) out = `/api/files/${f.id}`; }
    }
    links.set(href, out); return out;
  };
  // collect hrefs first (async), then rewrite synchronously
  const hrefs = new Set<string>(); const collect = (n: PMNode) => { for (const m of n.marks ?? []) if (m.type === "link" && typeof m.attrs?.href === "string") hrefs.add(m.attrs.href); n.content?.forEach(collect); }; nodes.forEach(collect);
  for (const h of hrefs) await resolveHref(h);
  const splitText = (n: PMNode): PMNode[] => {
    const text = n.text ?? ""; if (!TOKEN_RE.test(text)) { TOKEN_RE.lastIndex = 0; return [n]; } TOKEN_RE.lastIndex = 0;
    const out: PMNode[] = []; let last = 0; let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(text))) {
      if (m.index > last) out.push({ ...n, text: text.slice(last, m.index) });
      const idx = Number(m[2]);
      if (m[1] === "img") { const f = files.get(idx); if (f) out.push({ type: "image", attrs: { src: f.src, alt: f.alt || null, title: null } }); else out.push({ ...n, text: imgs[idx]?.alt ? `[image: ${imgs[idx].alt}]` : `[image: ${imgs[idx]?.src ?? ""}]` }); }
      else { const { id, label } = resolveRef(refs[idx]); if (id) out.push({ type: "mention", attrs: { id, label } }); else out.push({ ...n, text: label }); }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ ...n, text: text.slice(last) });
    return out;
  };
  const walk = (n: PMNode): PMNode[] => {
    if (n.type === "text") { const nn = n.marks?.some((m) => m.type === "link") ? { ...n, marks: n.marks!.map((m) => (m.type === "link" ? { ...m, attrs: { ...m.attrs, href: links.get(String(m.attrs?.href)) ?? m.attrs?.href } } : m)) } : n; return splitText(nn); }
    if (!n.content) return [n];
    let children = n.content.flatMap(walk);
    // marked emits the task checkbox as a stray "[x] " paragraph before the item text — drop it
    if ((n.type === "taskItem" || n.type === "listItem") && children.length > 1 && children[0].type === "paragraph" && children[0].content?.length === 1 && /^\[( |x|X)\]\s*$/.test(children[0].content[0].text ?? "")) children = children.slice(1);
    if (n.type === "paragraph" || n.type === "heading") {
      // images are block nodes: split the paragraph around them
      const out: PMNode[] = []; let buf: PMNode[] = [];
      const flush = () => { if (buf.length) out.push({ ...n, content: buf }); buf = []; };
      for (const c of children) { if (c.type === "image") { flush(); out.push(c); } else buf.push(c); }
      flush(); return out.length ? out : [{ ...n, content: [] }];
    }
    return [{ ...n, content: children }];
  };
  const content = nodes.flatMap(walk);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Relative (archive-local) targets of a Markdown body: images and links that are neither URLs nor anchors. Used by the import preview. */
export function relativeRefs(md: string): { images: string[]; links: string[] } {
  const images: string[] = []; const links: string[] = []; const rel = (s: string) => !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(s);
  const body = md.replace(/\r\n/g, "\n").split(/(^```[\s\S]*?^```$)/m).filter((_s, i) => i % 2 === 0).join("\n");
  for (const m of body.matchAll(IMG_RE)) if (rel(m[2])) images.push(safeDecode(m[2]));
  for (const m of body.replace(IMG_RE, " ").matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) if (rel(m[1])) links.push(safeDecode(m[1].replace(/#.*$/, "")));
  return { images, links };
}
/** Plain text the imported page would hold — computed without touching the database or storing files (duplicate detection, preview). */
export function previewText(md: string): string {
  const parts = md.replace(/\r\n/g, "\n").split(/(^```[\s\S]*?^```$)/m);
  const pre = parts.map((seg, i) => (i % 2 ? seg : seg.replace(IMG_RE, " ").replace(WIKI_RE, (_m, t: string, a?: string) => a?.trim() ?? t.trim()))).join("");
  return docText({ type: "doc", content: markdownToDoc(pre) });
}
/** Title, properties and body of a Markdown file, exactly as importMarkdown reads them. */
export function readMarkdown(src: string, filename?: string) {
  const { data, body } = parseFrontMatter(src);
  const nh = parseNotionHeader(body);
  const title = String(data.title ?? nh.title ?? (filename ?? "Untitled").replace(/^.*[\\/]/, "").replace(/\.(md|markdown|txt)$/i, "")).trim() || "Untitled";
  return { data, nh, title, body: nh.body };
}

/**
 * Full Markdown file → page (front-matter + Notion header aware). `existingId` updates a page created in a first pass.
 * With ctx.duplicates = "skip", a page with the same title and text is not created again: the existing page is returned.
 */
export async function importMarkdown(ctx: ImportCtx, src: string, opts: MdOptions & { filename?: string; parentId?: string | null; existingId?: string; section?: string; key?: string } = {}): Promise<Page> {
  const { data, nh, title } = readMarkdown(src, opts.filename);
  if (!opts.existingId && !(opts.key && ctx.ledger?.has(`page:${opts.key}`))) {
    const dup = findDuplicatePage(ctx, title, previewText(nh.body));
    if (dup) { const p = await getPageById(ctx, dup.id); if (p) { ctx.stats.duplicates++; ctx.stats.skipped.push(`“${p.title}” already exists with the same content — not imported again`); return p; } }
  }
  const props: Record<string, unknown> = { ...(typeof data.properties === "object" && data.properties ? (data.properties as Record<string, unknown>) : {}), ...nh.props };
  for (const [k, v] of Object.entries(data)) if (!["title", "id", "icon", "tags", "properties", "created", "updated", "type", "section", "database", "cover"].includes(k)) props[k] = v;
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : typeof data.tags === "string" ? data.tags.split(/[,;]\s*/).filter(Boolean) : typeof nh.props.Tags === "string" ? nh.props.Tags.split(/,\s*/).filter(Boolean) : [];
  if (tags.length) props.tags = tags;
  const doc = await mdToDoc(ctx, nh.body, opts);
  const icon = typeof data.icon === "string" ? data.icon.slice(0, 16) : null;
  const dates = { createdAt: data.created ? new Date(String(data.created)) : undefined, updatedAt: data.updated ? new Date(String(data.updated)) : undefined };
  const valid = (d?: Date) => (d && !isNaN(d.getTime()) ? d : undefined);
  if (opts.existingId) return updatePage(ctx, opts.existingId, { title, content: doc, icon, properties: props, updatedAt: valid(dates.updatedAt) });
  return createPage(ctx, { key: opts.key, title, parentId: opts.parentId ?? null, section: opts.section ?? (typeof data.section === "string" ? data.section : "notes"), content: doc, icon, properties: props, createdAt: valid(dates.createdAt), updatedAt: valid(dates.updatedAt) });
}
