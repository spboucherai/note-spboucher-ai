/**
 * file: src/lib/canvas/model.ts
 * description: the model of the Infinite Canvas (`spn-canvas-1`, SPEC §3.4) — one import for everything pure: types, tolerant reading
 *   and unknown-field preservation, ids, z-order, hit-testing, snapping guides, group move / resize, align / distribute (core.ts);
 *   edge routing with arrowheads anchored on the node outlines (routing.ts); three-way merge by node / edge id (merge.ts);
 *   grid and seeded force-directed auto-layout (layout.ts); viewport mathematics (viewport.ts); undo history (history.ts);
 *   text, Markdown outline and SVG export (export.ts). No DOM and no I/O anywhere below this file. The native apps mirror it
 *   (SPNotesCore: Canvas.swift, CanvasMerge.swift, CanvasLayout.swift); the contract is docs/next/CANVAS.md and the fixtures in
 *   tests/fixtures/canvas/.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
export { CANVAS_FORMAT, CANVAS_LIMITS, canvasProblem, canvasRefs } from "./format";
export * from "./core";
export * from "./routing";
export * from "./merge";
export * from "./layout";
export * from "./viewport";
export * from "./history";
export * from "./export";
