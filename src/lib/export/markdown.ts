/** Page → Markdown with YAML front-matter. Mentions become relative links when the resolver knows the target. */
import path from "node:path";
import { toMarkdown, type PMNode } from "@/lib/editor/text";
import { tagsOf, rowValuesByName, type ExportSet, type PageRow, type Placed } from "./data";

export interface Resolvers { mention?: (id: string, label: string) => string | null; file?: (src: string) => string | null }
const FILE_RE = /^\/api\/files\/([0-9a-f-]{36})/;
export const attachmentIdOf = (src: unknown) => (typeof src === "string" ? src.match(FILE_RE)?.[1] ?? null : null);

/** Deep-copies the doc, turning resolved mentions into linked text and rewriting /api/files/<id> sources. */
export function rewriteDoc(doc: PMNode, r: Resolvers): PMNode {
  const walk = (n: PMNode): PMNode => {
    if (n.type === "mention" && n.attrs?.kind !== "user") { const label = String(n.attrs?.label ?? n.attrs?.id ?? ""); const href = r.mention?.(String(n.attrs?.id ?? ""), label); if (href) return { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }; return n; }
    const out: PMNode = { ...n };
    if ((n.type === "image" || n.type === "fileBlock") && r.file && typeof n.attrs?.src === "string") { const nv = r.file(n.attrs.src); if (nv) out.attrs = { ...n.attrs, src: nv }; }
    if (n.marks?.some((m) => m.type === "link")) out.marks = n.marks.map((m) => { if (m.type !== "link" || typeof m.attrs?.href !== "string") return m; const href = m.attrs.href; const pm = href.match(/^\/p\/([0-9a-f-]{36})/); if (pm && r.mention) { const h = r.mention(pm[1], n.text ?? ""); if (h) return { ...m, attrs: { ...m.attrs, href: h } }; } if (r.file) { const f = r.file(href); if (f) return { ...m, attrs: { ...m.attrs, href: f } }; } return m; });
    if (n.content) out.content = n.content.map(walk);
    return out;
  };
  return walk(doc);
}

const yamlScalar = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return /^[A-Za-z0-9 _.,;!?()/À-ÿ-]*$/.test(s) && !/^(true|false|null|yes|no|~|\d.*|-.*|\s.*|.*\s)$/i.test(s) && s !== "" ? s : JSON.stringify(s);
};
export function frontMatter(obj: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  const emit = (k: string, v: unknown, indent: string) => {
    if (v === undefined) return;
    if (Array.isArray(v)) { if (!v.length) { lines.push(`${indent}${k}: []`); return; } if (v.every((x) => typeof x !== "object" || x === null)) { lines.push(`${indent}${k}: [${v.map(yamlScalar).join(", ")}]`); return; } lines.push(`${indent}${k}:`); for (const x of v) lines.push(`${indent}  - ${typeof x === "object" ? JSON.stringify(x) : yamlScalar(x)}`); return; }
    if (v && typeof v === "object" && !(v instanceof Date)) { const e = Object.entries(v as Record<string, unknown>); if (!e.length) { lines.push(`${indent}${k}: {}`); return; } lines.push(`${indent}${k}:`); for (const [kk, vv] of e) emit(kk, vv, indent + "  "); return; }
    lines.push(`${indent}${k}: ${yamlScalar(v)}`);
  };
  for (const [k, v] of Object.entries(obj)) emit(k, v, "");
  lines.push("---"); return lines.join("\n") + "\n";
}

/** Relative link from one exported file to another (POSIX). */
export const relLink = (fromFile: string, toFile: string) => { const r = path.posix.relative(path.posix.dirname(fromFile), toFile); return r.startsWith(".") ? r : `./${r}`; };

export function pageMarkdown(set: ExportSet, page: PageRow, opts: { resolvers?: Resolvers; placed?: Map<string, Placed>; withId?: boolean } = {}): string {
  const rowVals = rowValuesByName(set, page);
  const props = { ...(page.properties as Record<string, unknown>) }; delete props.tags;
  const fm: Record<string, unknown> = { title: page.title, ...(opts.withId === false ? {} : { id: page.id }), ...(page.icon ? { icon: page.icon } : {}), type: page.type, section: page.section, tags: tagsOf(set, page), created: page.createdAt.toISOString(), updated: page.updatedAt.toISOString() };
  if (rowVals && Object.keys(rowVals).length) fm.properties = rowVals; else if (Object.keys(props).length) fm.properties = props;
  if (page.databaseId) { const d = set.databases.find((x) => x.id === page.databaseId); if (d) fm.database = d.name; }
  const doc = rewriteDoc(page.content as PMNode, opts.resolvers ?? {});
  const body = toMarkdown(doc);
  return `${frontMatter(fm)}\n# ${page.title}\n\n${body}`;
}

/** Resolvers for a ZIP layout: mentions → relative .md links, files → attachments/… */
export function zipResolvers(set: ExportSet, placed: Map<string, Placed>, fromFile: string, attFile: (id: string) => string | null): Resolvers {
  return {
    mention: (id) => { const t = placed.get(id); return t ? relLink(fromFile, t.file) : null; },
    file: (src) => { const id = attachmentIdOf(src); if (!id) return null; const f = attFile(id); return f ? relLink(fromFile, f) : null; },
  };
}
/** Resolvers for a single-file export: mentions → absolute app links, files kept as /api/files/<id>. */
export const standaloneResolvers = (appUrl: string): Resolvers => ({ mention: (id) => `${appUrl}/p/${id}`, file: (src) => (attachmentIdOf(src) ? `${appUrl}${src}` : null) });
