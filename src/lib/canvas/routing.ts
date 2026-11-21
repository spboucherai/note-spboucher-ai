/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/canvas/routing.ts
 * Description      : geometry of the connections of a canvas — where an edge
 *                    leaves and reaches a card (anchored on the card's real
 *                    outline: rectangle, ellipse or diamond), the three routes
 *                    (straight, orthogonal elbow, curved), the arrowhead and
 *                    the label position. Pure: returns points and an SVG path
 *                    string; the same numbers feed the on-screen SVG,
 *                    hit-testing and the SVG / PNG export.
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

import type { CanvasEdge, CanvasNode } from "./format";
import { centerOf, rectOf, type Point, type Rect } from "./core";

/** Route style. Stored in the optional edge field `route` (web extension of spn-canvas-1; absent = "straight"; unknown values draw straight). */
export type RouteStyle = "straight" | "orthogonal" | "curved";
export type Side = "top" | "right" | "bottom" | "left";
export interface Route {
  style: RouteStyle;
  /** Polyline of the route (curves are sampled) — first point on the outline of `from`, last point on the outline of `to`. */
  points: Point[];
  /** SVG path data of the route. */
  d: string;
  /** Direction of arrival at the last point, in radians (atan2 convention, y down). */
  endAngle: number;
  /** Where a label sits: the midpoint of the route by length. */
  label: Point;
}
const r2 = (n: number) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const P = (x: number, y: number): Point => ({ x: r2(x), y: r2(y) });
export const routeStyleOf = (e: CanvasEdge): RouteStyle => (e.route === "orthogonal" || e.route === "curved" ? e.route : "straight");
/** An edge draws an arrowhead unless its `kind` is "line" (absent or unknown kinds are arrows). */
export const hasArrow = (e: CanvasEdge) => e.kind !== "line";

/**
 * The point where the ray from the node's centre towards `toward` crosses the node's outline. Rectangle for every kind except a
 * `shape` node with `shape: "ellipse" | "diamond"`. When `toward` is the centre itself the top-centre point is returned.
 */
export function anchorToward(n: CanvasNode, toward: Point): Point {
  const r = rectOf(n), c = centerOf(r); const dx = toward.x - c.x, dy = toward.y - c.y; const hw = r.w / 2, hh = r.h / 2;
  if (dx === 0 && dy === 0) return P(c.x, r.y);
  if (hw === 0 || hh === 0) return P(c.x, c.y);
  let t: number;
  if (n.kind === "shape" && n.shape === "ellipse") t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (n.kind === "shape" && n.shape === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return P(c.x + dx * t, c.y + dy * t);
}
/** Midpoint of a side of the node's bounding box (also on the outline of an ellipse and of a diamond). */
export function sideAnchor(n: CanvasNode, side: Side): Point {
  const r = rectOf(n);
  return side === "top" ? P(r.x + r.w / 2, r.y) : side === "bottom" ? P(r.x + r.w / 2, r.y + r.h) : side === "left" ? P(r.x, r.y + r.h / 2) : P(r.x + r.w, r.y + r.h / 2);
}
/**
 * Sides used by the orthogonal and curved routes: the pair facing each other along the axis with the larger gap between the two
 * boxes (horizontal wins a tie). Null when the boxes overlap on both axes — the caller then draws a straight line.
 */
export function facingSides(a: Rect, b: Rect): { from: Side; to: Side } | null {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX < 0 && gapY < 0) return null;
  if (gapX >= gapY) return b.x + b.w / 2 >= a.x + a.w / 2 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  return b.y + b.h / 2 >= a.y + a.h / 2 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}
const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

function polylineMid(pts: readonly Point[]): Point {
  let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= seg && seg > 0) { const t = half / seg; return P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t); }
    half -= seg;
  }
  return pts[0] ?? { x: 0, y: 0 };
}
const pathOf = (pts: readonly Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

/**
 * Route of an edge between two nodes.
 *  - straight: from the outline of `a` towards the centre of `b` to the outline of `b` towards the centre of `a`;
 *  - orthogonal: leaves and arrives at the middle of the facing sides, with one elbow half-way between them (3 segments);
 *  - curved: a cubic Bézier between the same side anchors, control points pushed out along the side normals by half the distance
 *    between the anchors (at least 40), sampled in 24 segments for hit-testing;
 *  - a node connected to itself: a loop above its top-right corner;
 *  - overlapping boxes fall back to the straight route.
 */
export function routeEdge(a: CanvasNode, b: CanvasNode, style: RouteStyle = "straight"): Route {
  if (a.id === b.id) {
    const r = rectOf(a); const x0 = r.x + r.w * 0.7, s = Math.max(24, Math.min(48, r.w * 0.3));
    const pts = [P(x0, r.y), P(x0, r.y - s), P(r.x + r.w + s, r.y - s), P(r.x + r.w + s, r.y + r.h * 0.3), P(r.x + r.w, r.y + r.h * 0.3)];
    return { style, points: pts, d: pathOf(pts), endAngle: Math.PI, label: P(r.x + r.w + s, r.y - s) };
  }
  const ra = rectOf(a), rb = rectOf(b); const sides = style === "straight" ? null : facingSides(ra, rb);
  if (!sides) {
    const p0 = anchorToward(a, centerOf(rb)), p1 = anchorToward(b, centerOf(ra)); const pts = [p0, p1];
    return { style: "straight", points: pts, d: pathOf(pts), endAngle: angle(p0, p1), label: polylineMid(pts) };
  }
  const p0 = sideAnchor(a, sides.from), p1 = sideAnchor(b, sides.to);
  if (style === "orthogonal") {
    const horizontal = sides.from === "left" || sides.from === "right";
    const pts = horizontal ? [p0, P((p0.x + p1.x) / 2, p0.y), P((p0.x + p1.x) / 2, p1.y), p1] : [p0, P(p0.x, (p0.y + p1.y) / 2), P(p1.x, (p0.y + p1.y) / 2), p1];
    return { style, points: pts, d: pathOf(pts), endAngle: angle(pts[2], pts[3]), label: polylineMid(pts) };
  }
  const reach = Math.max(40, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2); const n0 = NORMAL[sides.from], n1 = NORMAL[sides.to];
  const c0 = P(p0.x + n0.x * reach, p0.y + n0.y * reach), c1 = P(p1.x + n1.x * reach, p1.y + n1.y * reach);
  const pts: Point[] = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push(P(u * u * u * p0.x + 3 * u * u * t * c0.x + 3 * u * t * t * c1.x + t * t * t * p1.x, u * u * u * p0.y + 3 * u * u * t * c0.y + 3 * u * t * t * c1.y + t * t * t * p1.y)); }
  return { style, points: pts, d: `M${p0.x} ${p0.y} C${c0.x} ${c0.y} ${c1.x} ${c1.y} ${p1.x} ${p1.y}`, endAngle: angle(c1, p1), label: polylineMid(pts) };
}

/** Triangle of an arrowhead whose tip is `tip`, pointing along `angleRad`. Returns the three corners (tip first). */
export function arrowHead(tip: Point, angleRad: number, size = 10): [Point, Point, Point] {
  const spread = Math.PI / 7;
  return [P(tip.x, tip.y), P(tip.x - size * Math.cos(angleRad - spread), tip.y - size * Math.sin(angleRad - spread)), P(tip.x - size * Math.cos(angleRad + spread), tip.y - size * Math.sin(angleRad + spread))];
}
