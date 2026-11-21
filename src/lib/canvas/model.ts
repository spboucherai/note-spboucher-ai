/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/canvas/model.ts
 * Description      : the model of the Infinite Canvas (`spn-canvas-1`, SPEC
 *                    §3.4) — one import for everything pure: types, tolerant
 *                    reading and unknown-field preservation, ids, z-order,
 *                    hit-testing, snapping guides, group move / resize, align /
 *                    distribute (core.ts); edge routing with arrowheads
 *                    anchored on the node outlines (routing.ts); three-way
 *                    merge by node / edge id (merge.ts); grid and seeded
 *                    force-directed auto-layout (layout.ts); viewport
 *                    mathematics (viewport.ts); undo history (history.ts);
 *                    text, Markdown outline and SVG export (export.ts). No DOM
 *                    and no I/O anywhere below this file. The native apps
 *                    mirror it (SPNotesCore: Canvas.swift, CanvasMerge.swift,
 *                    CanvasLayout.swift); the contract is docs/next/CANVAS.md
 *                    and the fixtures in tests/fixtures/canvas/.
 * Module           : lib
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

export { CANVAS_FORMAT, CANVAS_LIMITS, canvasProblem, canvasRefs } from "./format";
export * from "./core";
export * from "./routing";
export * from "./merge";
export * from "./layout";
export * from "./viewport";
export * from "./history";
export * from "./export";
