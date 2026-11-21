/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/export/index.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

export { loadExportSet, assignPaths, tagsOf, rowValuesByName, attachmentFile, ExportNotFound } from "./data";
export type { ExportSet, PageRow, Placed } from "./data";
export { pageMarkdown, rewriteDoc, frontMatter, relLink, zipResolvers, standaloneResolvers, attachmentIdOf } from "./markdown";
export { docToHtml, printHtml } from "./html";
export { databaseCsv, cellToString, csvSafe } from "./csv";
export { workspaceJson, JSON_FORMAT } from "./json";
export { exportZip, buildZip, ExportTooLarge, ZIP_MAX_BYTES, type ExportReport } from "./zip";
/** Values accepted by `GET /api/export?format=` (`pdf` and `html` are the same print view). */
export const EXPORT_FORMATS: readonly string[] = ["md", "zip", "json", "csv", "pdf", "html", "bib"];
/** Message of the 400 answered to an unknown format: it lists every accepted value. */
export const badFormatMessage = () => `format must be one of ${EXPORT_FORMATS.join(", ")}`;
