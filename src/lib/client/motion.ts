/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/motion.ts
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

"use client";
/**
 * file: src/lib/client/motion.ts
 * description: Lumen motion layer — the motion tokens of globals.css as JS values and the web side of the signature motions
 *   (1 Living Pages, 2 Morphing Editor, 4 Fluid Navigation, 5 Intelligent Panels, 6 Quick Capture, 7 Semantic Zoom).
 *   Rules: only `opacity`, `transform` and `filter` are animated (compositor only, no layout work per frame); layout is read at most once
 *   per motion and never while the user types; every motion degrades to a plain cross-fade ≤ 120 ms under `prefers-reduced-motion`.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useSyncExternalStore } from "react";

export const DUR = { instant: 90, fast: 160, base: 240, slow: 420, ambient: 900, spring: 620, reduced: 120 } as const;
export const EASE = { standard: "cubic-bezier(.2,.8,.2,1)", exit: "cubic-bezier(.4,0,1,1)", spring: "linear(0, 0.0721, 0.2278, 0.4049, 0.5697, 0.7071, 0.8131, 0.8899, 0.9422, 0.9757, 0.9954, 1.0058, 1.0102, 1.0111, 1.0101, 1.0083, 1.0063, 1.0045, 1.0031, 1.0019, 1.0011, 1.0006, 1.0002, 1, 1)" } as const;
export const LIVING_PAGES = { rise: 6, stagger: 18, cap: 24 } as const;

const RM = "(prefers-reduced-motion: reduce)";
export const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(RM).matches;
const subRM = (cb: () => void) => { const m = window.matchMedia(RM); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/** `prefers-reduced-motion` as React state (false during SSR). */
export const useReducedMotion = () => useSyncExternalStore(subRM, prefersReducedMotion, () => false);

type KF = Keyframe[] | PropertyIndexedKeyframes;
const FADE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
/**
 * Web Animations wrapper. Under Reduce Motion the keyframes are replaced by a 120 ms cross-fade (or nothing when `fade` is false),
 * delays are dropped. Returns null when the platform has no WAAPI — callers never depend on the animation having run.
 */
export function animate(el: Element | null | undefined, keyframes: KF, opts: KeyframeAnimationOptions & { fade?: boolean } = {}): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== "function") return null;
  const { fade = true, ...o } = opts;
  try {
    if (prefersReducedMotion()) return fade ? (el as HTMLElement).animate(FADE, { duration: DUR.reduced, easing: "linear" }) : null;
    return (el as HTMLElement).animate(keyframes, { duration: DUR.base, easing: EASE.standard, ...o });
  } catch { return null; }
}

/**
 * 1 — Living Pages. The first blocks of a page rise 6 px and fade in, 18 ms apart, capped at 24 blocks (the rest is already below the
 * fold). Runs once when a page opens. Web Animations on the block elements: ProseMirror owns their attributes and would strip a class,
 * and an animation never touches the document or its layout. Reduce Motion: one 120 ms cross-fade of the whole container.
 */
export function revealBlocks(container: Element | null | undefined, opts: { selector?: string } = {}): number {
  if (!container) return 0;
  if (prefersReducedMotion()) { animate(container, FADE); return 0; }
  const blocks = Array.from(opts.selector ? container.querySelectorAll(opts.selector) : container.children).slice(0, LIVING_PAGES.cap);
  blocks.forEach((b, i) => animate(b, [{ opacity: 0, transform: `translateY(${LIVING_PAGES.rise}px)` }, { opacity: 1, transform: "none" }], { duration: DUR.base, delay: i * LIVING_PAGES.stagger, fill: "backwards" }));
  return blocks.length;
}

/**
 * 2 — Morphing Editor. Call after the toolbar's content changed (new block type selected): the container tweens from its previous
 * width to the new one (`transform`-free: width is animated on a tiny, absolutely positioned bar only, never on the document) while the
 * new content uses the `.morph-in` class. `prevWidth` is the width measured before the change (one read, on context change only).
 */
export function morphWidth(el: HTMLElement | null, prevWidth: number | null): void {
  if (!el || prevWidth == null || prefersReducedMotion()) return;
  const next = el.offsetWidth; if (!next || Math.abs(next - prevWidth) < 2) return;
  animate(el, [{ width: `${prevWidth}px` }, { width: `${next}px` }], { duration: DUR.fast, easing: EASE.standard, fade: false });
}

type VTDocument = Document & { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void>; ready: Promise<void>; skipTransition: () => void } };
export const supportsViewTransitions = () => typeof document !== "undefined" && typeof (document as VTDocument).startViewTransition === "function";
/**
 * 4 — Fluid Navigation. Runs `update` (a navigation or a state change) inside a View Transition when the browser has the API; otherwise
 * just runs it. `settled` resolves when the new view is in the DOM (the transition waits for it, at most `timeout` ms).
 * Reduce Motion keeps the API (CSS shortens it to a 120 ms cross-fade and cancels the shared-element group).
 */
export function withViewTransition(update: () => void | Promise<void>, settled?: () => boolean, timeout = 900): Promise<void> {
  const doc = document as VTDocument;
  const wait = () => new Promise<void>((resolve) => { if (!settled) return resolve(); const t0 = performance.now(); const tick = () => { if (settled() || performance.now() - t0 > timeout) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  if (!supportsViewTransitions()) { return Promise.resolve(update()).then(() => undefined); }
  try { const vt = doc.startViewTransition!(async () => { await update(); await wait(); }); return vt.finished.catch(() => undefined); } catch { return Promise.resolve(update()).then(() => undefined); }
}
/**
 * Shared-element title: tags `source` (the row title that was clicked) with the `page-title` transition name for the outgoing snapshot;
 * the page's own title carries the same name in the incoming view (class `vt-page-title`). The tag is removed as soon as the snapshot is taken.
 */
export function navigateWithTitle(source: HTMLElement | null, navigate: () => void, arrived: () => boolean): Promise<void> {
  if (!source || !supportsViewTransitions()) { navigate(); return Promise.resolve(); }
  // a transition name must be unique in each snapshot: while the row carries it, the title of the page being left gives it up (CSS: html[data-vt-source])
  const root = document.documentElement; root.dataset.vtSource = "1"; source.style.setProperty("view-transition-name", "page-title");
  const clear = () => { source.style.removeProperty("view-transition-name"); delete root.dataset.vtSource; };
  return withViewTransition(() => { clear(); navigate(); }, arrived).finally(clear);
}

/** 5 — Intelligent Panels: class for a panel entering from an edge (CSS keyframes: slide 18 px + blur 6 px → sharp). */
export const panelClass = (edge: "right" | "left" | "bottom") => `panel-in-${edge}`;

/**
 * 6 — Quick Capture: Lumen pulse on save. A gradient disc grows from `origin` and fades (one layout read, on save only; the disc is a
 * fixed-position element appended to <body>, removed when done). Reduce Motion: a brief static glow only.
 */
export function lumenPulse(origin: Element | null | undefined): void {
  if (typeof document === "undefined") return;
  const r = origin?.getBoundingClientRect(); const x = r ? r.left + r.width / 2 : window.innerWidth / 2; const y = r ? r.top + r.height / 2 : window.innerHeight - 80;
  const size = 56; const d = document.createElement("div"); d.className = "lumen-pulse"; d.setAttribute("aria-hidden", "true"); d.dataset.motion = "lumen-pulse";
  d.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;opacity:0`;
  document.body.appendChild(d);
  const a = prefersReducedMotion()
    ? d.animate([{ opacity: 0 }, { opacity: .35 }, { opacity: 0 }], { duration: DUR.reduced * 2, easing: "linear" })
    : d.animate([{ opacity: .55, transform: "scale(.4)" }, { opacity: .28, transform: "scale(2.6)", offset: .55 }, { opacity: 0, transform: "scale(3.6)" }], { duration: DUR.slow + DUR.fast, easing: EASE.standard });
  const done = () => d.remove(); a.addEventListener("finish", done); a.addEventListener("cancel", done); setTimeout(done, 1500);
}

/**
 * 7 — Semantic Zoom. Cross-dissolves `container` around a content change (`apply`) while keeping the reader's place: the first block
 * visible at the top of `scroller` (identified by `[data-id]`) is found before the change and brought back to the same offset after
 * it. If that block is hidden by the new level, the nearest visible block before it is used.
 */
export async function semanticZoom(container: HTMLElement | null, scroller: HTMLElement | null, apply: () => void | Promise<void>): Promise<void> {
  if (!container) { await apply(); return; }
  const top = scroller?.getBoundingClientRect().top ?? 0;
  const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-id]"));
  let anchorIndex = -1, offset = 0;
  for (let i = 0; i < blocks.length; i++) { const r = blocks[i].getBoundingClientRect(); if (r.height > 0 && r.bottom > top + 1) { anchorIndex = i; offset = r.top - top; break; } }
  const out = animate(container, [{ opacity: 1 }, { opacity: 0 }], { duration: prefersReducedMotion() ? DUR.reduced / 2 : DUR.fast / 2, easing: EASE.exit, fill: "forwards", fade: false }) ?? (prefersReducedMotion() ? container.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 60, fill: "forwards" }) : null);
  try { await out?.finished; } catch { /* cancelled */ }
  await apply();
  if (scroller && anchorIndex >= 0) {
    let a: HTMLElement | null = null; for (let i = anchorIndex; i >= 0; i--) { const b = blocks[i]; if (b.isConnected && b.getBoundingClientRect().height > 0) { a = b; break; } }
    if (a) scroller.scrollTop += a.getBoundingClientRect().top - top - (a === blocks[anchorIndex] ? offset : 0);
  }
  out?.cancel();
  animate(container, FADE, { duration: prefersReducedMotion() ? DUR.reduced : DUR.fast });
}
