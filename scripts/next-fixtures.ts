/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/next-fixtures.ts
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
 * Regenerates the expected outputs of tests/fixtures/next-nodes/*.json (Markdown `.md`, plain text `.txt`, print HTML `.html`).
 * These files are the cross-platform contract for the 3.0 nodes: SPNotesCore `MarkdownExport` must produce the same bytes.
 * Run ONLY after a deliberate change of the export rules, and review the diff:  node_modules/.bin/tsx scripts/next-fixtures.ts
 * The unit test tests/unit/next-nodes.test.ts compares, it never writes.
 */
import fs from "node:fs";
import path from "node:path";
import { toMarkdown, docText } from "../src/lib/editor/text";
import { docToHtml } from "../src/lib/export/html";
const dir = path.join(process.cwd(), "tests/fixtures/next-nodes");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); const base = path.join(dir, f.replace(/\.json$/, ""));
  fs.writeFileSync(`${base}.md`, toMarkdown(doc)); fs.writeFileSync(`${base}.txt`, docText(doc)); fs.writeFileSync(`${base}.html`, docToHtml(doc).html + "\n");
  console.log(f, "→ .md .txt .html");
}
