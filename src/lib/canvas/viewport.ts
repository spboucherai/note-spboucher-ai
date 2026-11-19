/**
 * file: src/lib/canvas/viewport.ts
 * description: viewport mathematics of the canvas. Convention for `viewport: {x, y, zoom}` of spn-canvas-1 (documented in
 *   docs/next/CANVAS.md so every client reads it the same way): (x, y) is the WORLD point shown at the top-left corner of the view and
 *   `zoom` is screen pixels (points) per world unit — screen = (world − {x, y}) × zoom. Pure.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { Point, Rect } from "./core";

export interface Viewport { x: number; y: number; zoom: number; [k: string]: unknown }
export interface Size { w: number; h: number }
export const ZOOM_MIN = 0.05, ZOOM_MAX = 4;
export const clampZoom = (z: number, min = ZOOM_MIN, max = ZOOM_MAX) => (Number.isFinite(z) ? Math.min(max, Math.max(min, z)) : 1);
export const worldToScreen = (v: Viewport, p: Point): Point => ({ x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom });
export const screenToWorld = (v: Viewport, p: Point): Point => ({ x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y });
/** The world rectangle visible in a view of `size` screen pixels, grown by `margin` screen pixels on every side. */
export const visibleRect = (v: Viewport, size: Size, margin = 0): Rect => ({ x: v.x - margin / v.zoom, y: v.y - margin / v.zoom, w: (size.w + 2 * margin) / v.zoom, h: (size.h + 2 * margin) / v.zoom });
/** Pans by a screen-space delta (dragging the content by (dx, dy) pixels). */
export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({ ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom });
/** Zooms to `zoom` (clamped) keeping the world point under the screen point `at` fixed — zoom around the cursor / the pinch centre. */
export function zoomTo(v: Viewport, zoom: number, at: Point): Viewport {
  const z = clampZoom(zoom); if (z === v.zoom) return v;
  const w = screenToWorld(v, at);
  return { ...v, zoom: z, x: w.x - at.x / z, y: w.y - at.y / z };
}
export const zoomBy = (v: Viewport, factor: number, at: Point): Viewport => zoomTo(v, v.zoom * factor, at);
/**
 * The viewport that shows `bounds` entirely, centred, with `padding` screen pixels around it. Never zooms in beyond `maxZoom`
 * (1 by default: fitting a single small card does not magnify it). Null bounds (empty canvas) → origin at zoom 1.
 */
export function fitToContent(bounds: Rect | null, size: Size, padding = 48, maxZoom = 1): Viewport {
  if (!bounds || !(size.w > 0) || !(size.h > 0)) return { x: 0, y: 0, zoom: 1 };
  const availW = Math.max(1, size.w - 2 * padding), availH = Math.max(1, size.h - 2 * padding);
  const zoom = clampZoom(Math.min(bounds.w > 0 ? availW / bounds.w : Infinity, bounds.h > 0 ? availH / bounds.h : Infinity, maxZoom));
  return { zoom, x: bounds.x + bounds.w / 2 - size.w / (2 * zoom), y: bounds.y + bounds.h / 2 - size.h / (2 * zoom) };
}
/** The viewport of the same zoom centred on a world point. */
export const centerOn = (v: Viewport, p: Point, size: Size): Viewport => ({ ...v, x: p.x - size.w / (2 * v.zoom), y: p.y - size.h / (2 * v.zoom) });
/** Wheel / pinch delta → zoom factor (exponential, so zooming in then out by the same delta returns to the start). */
export const wheelZoomFactor = (deltaY: number, pinch: boolean) => Math.exp(-deltaY * (pinch ? 0.01 : 0.0015));
