/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/build-model-logos.ts
 * Module           : scripts
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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

/**
 * Generates public/model-logos/ from the creator registry (src/lib/ai/creators.ts):
 *   <creator>.svg   copied verbatim from the installed `simple-icons` package (CC0-1.0) for the creators it contains
 *   generic.svg     neutral mark (own drawing) used by every creator without an authorised logo
 *   registry.json   creator → file, licence, source — consumed by the native apps to build their asset catalogues
 * It never draws a brand: a slug missing from the installed simple-icons version makes the script fail.
 *   node_modules/.bin/tsx scripts/build-model-logos.ts          (re-run after `pnpm up simple-icons`, then update SIMPLE_ICONS_VERSION)
 */
import fs from "node:fs";
import path from "node:path";
import { CREATORS, ROUTE_LOGOS, SIMPLE_ICONS_VERSION, logoOf, GENERIC_LOGO } from "../src/lib/ai/creators";

const SI = path.resolve("node_modules/simple-icons");
const OUT = path.resolve("public/model-logos");
const version = JSON.parse(fs.readFileSync(path.join(SI, "package.json"), "utf8")).version as string;
if (version !== SIMPLE_ICONS_VERSION) throw new Error(`simple-icons ${version} is installed but creators.ts says ${SIMPLE_ICONS_VERSION}: update SIMPLE_ICONS_VERSION after reviewing the icons.`);
const data: { slug?: string; title: string; hex: string; source: string; license?: { type: string; url?: string }; guidelines?: string }[] = JSON.parse(fs.readFileSync(path.join(SI, "data/simple-icons.json"), "utf8"));
const titleToSlug = (t: string) => t.toLowerCase().replace(/\+/g, "plus").replace(/\./g, "dot").replace(/&/g, "and").normalize("NFD").replace(/[^a-z0-9]/g, "");
const meta = (slug: string) => data.find((d) => (d.slug ?? titleToSlug(d.title)) === slug);

fs.mkdirSync(OUT, { recursive: true });
const GENERIC = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Modèle IA</title><path d="M12 1.5 21.1 6.75v10.5L12 22.5l-9.1-5.25V6.75L12 1.5Zm0 2.31L4.9 7.9v8.2l7.1 4.09 7.1-4.09V7.9L12 3.81ZM12 7.25l1.34 3.41L16.75 12l-3.41 1.34L12 16.75l-1.34-3.41L7.25 12l3.41-1.34L12 7.25Z"/></svg>\n`;
fs.writeFileSync(path.join(OUT, "generic.svg"), GENERIC);

interface Entry { id: string; kind: "creator" | "route"; name: string; file: string; logo: string; generic: boolean; monogram?: string; hex: string | null; source: string; licence: string; sourceUrl: string | null; guidelines: string | null; note: string | null }
const entries: Entry[] = [];
const copy = (id: string, slug: string) => {
  const m = meta(slug); const src = path.join(SI, "icons", `${slug}.svg`);
  if (!m || !fs.existsSync(src)) throw new Error(`simple-icons ${version} has no icon "${slug}" (creator ${id}) — use simpleIcon: null`);
  if (m.license && m.license.type !== "CC0-1.0") throw new Error(`simple-icons icon "${slug}" carries its own licence (${m.license.type}) — not shipped; use simpleIcon: null`);
  fs.writeFileSync(path.join(OUT, `${id}.svg`), fs.readFileSync(src, "utf8").trim() + "\n");
  return m;
};
for (const c of CREATORS) {
  const m = c.simpleIcon ? copy(c.id, c.simpleIcon) : null;
  entries.push({ id: c.id, kind: "creator", name: c.name, file: m ? `${c.id}.svg` : "generic.svg", logo: logoOf(c), generic: !m, monogram: c.monogram, hex: m ? m.hex : null,
    source: m ? `simple-icons@${version}:${c.simpleIcon}` : "generic", licence: m ? "CC0-1.0 (simple-icons collection); trademark of its owner" : "own work, CC0-1.0", sourceUrl: m?.source ?? null, guidelines: m?.guidelines ?? null, note: c.note ?? null });
}
for (const r of ROUTE_LOGOS) {
  const m = r.simpleIcon ? copy(r.id, r.simpleIcon) : null;
  entries.push({ id: r.id, kind: "route", name: r.name, file: m ? `${r.id}.svg` : "generic.svg", logo: m ? `/model-logos/${r.id}.svg` : GENERIC_LOGO, generic: !m, hex: m ? m.hex : null,
    source: m ? `simple-icons@${version}:${r.simpleIcon}` : "generic", licence: m ? "CC0-1.0 (simple-icons collection); trademark of its owner" : "own work, CC0-1.0", sourceUrl: m?.source ?? null, guidelines: m?.guidelines ?? null, note: m ? null : "no authorised logo: generic mark" });
}
const registry = { version: 1, generatedFrom: `simple-icons@${version}`, fallback: "generic.svg", template: true, note: "Single-colour SVGs (viewBox 0 0 24 24, no fill attribute): render them as template images / CSS masks tinted with the text colour.", entries };
fs.writeFileSync(path.join(OUT, "registry.json"), JSON.stringify(registry, null, 2) + "\n");
// remove stale svg files that no entry references any more
const keep = new Set(["generic.svg", "registry.json", ...entries.map((e) => e.file)]);
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.rmSync(path.join(OUT, f));
console.log(`model logos: ${entries.filter((e) => !e.generic).length} from simple-icons@${version}, ${entries.filter((e) => e.generic).length} generic → ${path.relative(process.cwd(), OUT)}`);
