/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/graph/layout.ts
 * Description      : deterministic force layout for large graphs (the 5 000
 *                    nodes / 20 000 edges tier of the Knowledge Graph 2.0),
 *                    written on typed arrays so one iteration costs a few
 *                    milliseconds: spring attraction along the edges (weaker on
 *                    hubs), repulsion between nearby nodes through a uniform
 *                    grid (3 × 3 cells, so the cost is linear in the number of
 *                    nodes), a light pull to the centre that keeps unconnected
 *                    pages in view, and a cooling schedule. No randomness: the
 *                    start positions are a golden-angle spiral, the same graph
 *                    always gives the same picture. Pure — runs in the browser
 *                    (time-sliced by the canvas) and in the unit tests.
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

export interface LayoutState { n: number; x: Float32Array; y: Float32Array; src: Uint32Array; dst: Uint32Array; strength: Float32Array; iter: number; total: number }
const K = 28; // ideal distance between neighbours, in graph units
const LINK = 34; const CELL = K * 2.2;

/** `edges` are pairs of node indexes; `at(i)` may give a previous position (kept across data refreshes so filters do not reshuffle). */
export function initLayout(n: number, edges: [number, number][], at?: (i: number) => { x: number; y: number } | null | undefined, total = 150): LayoutState {
  const x = new Float32Array(n), y = new Float32Array(n); let known = 0;
  for (let i = 0; i < n; i++) { const p = at?.(i); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { x[i] = p.x; y[i] = p.y; known++; } else { const r = K * 0.95 * Math.sqrt(i + 0.5), t = i * 2.399963229728653; x[i] = r * Math.cos(t); y[i] = r * Math.sin(t); } }
  const ok = edges.filter(([a, b]) => a !== b && a >= 0 && b >= 0 && a < n && b < n); const src = new Uint32Array(ok.length), dst = new Uint32Array(ok.length); const deg = new Uint32Array(n);
  ok.forEach(([a, b], e) => { src[e] = a; dst[e] = b; deg[a]++; deg[b]++; });
  const strength = new Float32Array(ok.length); for (let e = 0; e < ok.length; e++) strength[e] = 1 / Math.max(1, Math.min(deg[src[e]], deg[dst[e]]));
  // a graph that already has its positions only needs a short relaxation
  return { n, x, y, src, dst, strength, iter: known === n && n > 0 ? Math.floor(total * 0.8) : 0, total };
}
export const layoutDone = (s: LayoutState) => s.iter >= s.total;
/** Runs up to `iterations` iterations; returns true when the layout has cooled down. */
export function stepLayout(s: LayoutState, iterations = 1): boolean {
  const { n, x, y, src, dst, strength } = s; if (!n) { s.iter = s.total; return true; }
  const dx = new Float32Array(n), dy = new Float32Array(n);
  for (let it = 0; it < iterations && s.iter < s.total; it++, s.iter++) {
    dx.fill(0); dy.fill(0);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i]; }
    let cell = CELL; let gx = Math.floor((x1 - x0) / cell) + 1, gy = Math.floor((y1 - y0) / cell) + 1; while (gx * gy > 262144) { cell *= 2; gx = Math.floor((x1 - x0) / cell) + 1; gy = Math.floor((y1 - y0) / cell) + 1; }
    const cellOf = new Int32Array(n); const start = new Int32Array(gx * gy + 1);
    for (let i = 0; i < n; i++) { const c = Math.floor((x[i] - x0) / cell) + gx * Math.floor((y[i] - y0) / cell); cellOf[i] = c; start[c + 1]++; }
    for (let c = 0; c < gx * gy; c++) start[c + 1] += start[c];
    const fill = start.slice(0, gx * gy); const order = new Int32Array(n); for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
    const reach = cell * cell;
    for (let i = 0; i < n; i++) {
      const cx = cellOf[i] % gx, cy = (cellOf[i] - cx) / gx; let fx = 0, fy = 0;
      for (let oy = -1; oy <= 1; oy++) { const yy = cy + oy; if (yy < 0 || yy >= gy) continue; for (let ox = -1; ox <= 1; ox++) { const xx = cx + ox; if (xx < 0 || xx >= gx) continue; const c = xx + gx * yy;
        for (let k = start[c]; k < start[c + 1]; k++) { const j = order[k]; if (j === i) continue; let ddx = x[i] - x[j], ddy = y[i] - y[j]; let d2 = ddx * ddx + ddy * ddy; if (d2 >= reach) continue; if (d2 < 0.01) { ddx = ((i * 7 + j * 13) % 11) / 11 - 0.5 + 0.01; ddy = ((i * 5 + j * 3) % 7) / 7 - 0.5 + 0.01; d2 = ddx * ddx + ddy * ddy; } const f = (K * K) / d2; fx += ddx * f; fy += ddy * f; } } }
      dx[i] += fx; dy[i] += fy;
    }
    for (let e = 0; e < src.length; e++) { const a = src[e], b = dst[e]; const ddx = x[b] - x[a], ddy = y[b] - y[a]; const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01; const f = ((d - LINK) / d) * strength[e] * 0.9; dx[a] += ddx * f; dy[a] += ddy * f; dx[b] -= ddx * f; dy[b] -= ddy * f; }
    const cool = 1 - s.iter / s.total; const temp = 42 * cool * cool + 0.4;
    for (let i = 0; i < n; i++) { const gx2 = dx[i] - x[i] * 0.012, gy2 = dy[i] - y[i] * 0.012; const len = Math.sqrt(gx2 * gx2 + gy2 * gy2); if (len > 0) { const m = Math.min(len, temp) / len; x[i] += gx2 * m; y[i] += gy2 * m; } }
  }
  return s.iter >= s.total;
}
