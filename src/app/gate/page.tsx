import type { Metadata } from "next";
export const metadata: Metadata = { title: { absolute: "Locked" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Neutral access gate: one password field, no account. Works without JavaScript (plain form POST). */
export default async function Gate({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const sp = await searchParams; const err = sp.e === "1" ? "Wrong password." : sp.e === "2" ? "Too many attempts. Wait a minute." : null;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6">
      <form method="post" action="/api/gate" className="flex w-full max-w-[17rem] flex-col items-center gap-4">
        <svg aria-hidden viewBox="0 0 24 24" className="size-7 text-fg-faint" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label htmlFor="pw" className="sr-only">Password</label>
        <input id="pw" name="password" type="password" inputMode="numeric" autoComplete="current-password" autoFocus required maxLength={128}
          aria-invalid={err ? true : undefined} aria-describedby={err ? "gate-err" : undefined}
          className="h-11 w-full rounded-xl border border-line bg-bg-elev px-4 text-center text-[15px] tracking-[0.3em] shadow-card outline-none transition focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15" />
        <button type="submit" className="sr-only">Unlock</button>
        <p id="gate-err" role="status" className="h-4 text-[12px] text-danger">{err}</p>
      </form>
    </main>
  );
}
