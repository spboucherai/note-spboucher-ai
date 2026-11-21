/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/copy-vendor.mjs
 * Description      : copies the pdf.js worker (and its optional data folders)
 *                    from node_modules to public/vendor/pdfjs so the PDF block
 *                    can load it from our own origin (CSP: worker-src 'self').
 *                    Runs before `next dev` / `next build` (see package.json);
 *                    the folder is git-ignored.
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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules/pdfjs-dist"); const out = path.join(root, "public/vendor/pdfjs");
if (!fs.existsSync(src)) { console.error("copy-vendor: pdfjs-dist is not installed"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(src, "build/pdf.worker.min.mjs"), path.join(out, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) { const from = path.join(src, dir); if (fs.existsSync(from)) fs.cpSync(from, path.join(out, dir), { recursive: true }); }
fs.writeFileSync(path.join(out, "VERSION"), JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version + "\n");
console.log("copy-vendor: pdf.js assets → public/vendor/pdfjs");
