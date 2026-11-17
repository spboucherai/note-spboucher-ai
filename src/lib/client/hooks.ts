"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

const subOnline = (cb: () => void) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); }; };
/** navigator.onLine as React state (true during SSR). */
export const useOnline = () => useSyncExternalStore(subOnline, () => navigator.onLine, () => true);

const mq = (q: string) => (cb: () => void) => { const m = window.matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/** Phone-sized layout (below the `md` breakpoint). False during SSR; settles on the first client render. */
export const useIsPhone = () => useSyncExternalStore(mq("(max-width: 767.98px)"), () => window.matchMedia("(max-width: 767.98px)").matches, () => false);
/** Primary input is a finger (no hover, coarse pointer). */
export const useIsTouch = () => useSyncExternalStore(mq("(pointer: coarse)"), () => window.matchMedia("(pointer: coarse)").matches, () => false);

/**
 * Space taken at the bottom of the layout viewport by the on-screen keyboard, in px (0 when closed).
 * iOS Safari does not resize the layout viewport when the keyboard opens, so `position: fixed; bottom: 0` ends up under the keys: anything
 * docked to the bottom must be lifted by this inset. Also publishes --kb (inset) and --vvh (visible height) on <html>, and data-kb="open".
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    let raf = 0;
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const i = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); const open = i > 80; // below 80 px it is a toolbar/URL bar, not a keyboard
      const root = document.documentElement; root.style.setProperty("--kb", `${open ? i : 0}px`); root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      if (open) root.dataset.kb = "open"; else delete root.dataset.kb; setInset(open ? i : 0);
    }); };
    update(); vv.addEventListener("resize", update); vv.addEventListener("scroll", update); window.addEventListener("orientationchange", update);
    return () => { cancelAnimationFrame(raf); vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); window.removeEventListener("orientationchange", update); };
  }, []);
  return inset;
}
/** True once per mount after hydration — for UI that must not render on the server (viewport-dependent). */
export function useMounted() { const [m, setM] = useState(false); useEffect(() => setM(true), []); return m; }
