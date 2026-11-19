import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
// The design-system utilities are declared to tailwind-merge: without this `text-ui` / `text-micro` (font sizes) are taken for text
// colours and silently dropped next to `text-fg-muted`, and the semantic radii / shadows do not override Tailwind's own.
const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["micro", "ui", "body", "h3", "h2", "h1", "display"] }], rounded: [{ rounded: ["chip", "control", "pop", "card", "sheet", "pill"] }], shadow: [{ shadow: ["card", "pop", "glass"] }] } } });
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const fmtDate = (d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => (d ? new Intl.DateTimeFormat("en-CA", opts).format(new Date(d)) : "");
export function timeAgo(d: Date | string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`; return fmtDate(d);
}
export const money = (n: number | null | undefined, digits = 4) => (n == null ? "–" : `$${n.toFixed(n < 0.01 ? digits : 3)}`);
export const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) { let t: any; return (...a: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
