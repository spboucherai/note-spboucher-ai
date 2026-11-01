import { LoginForm } from "./login-form";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
export const metadata = { title: "Sign in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; step?: string }> }) {
  const sp = await searchParams; const s = await getSession();
  if (s && (!s.totpEnabled || s.mfaPassed)) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/");
  return (
    <main className="min-h-dvh grid place-items-center bg-bg-sunk px-4 safe-top safe-bottom">
      <div className="w-full max-w-sm fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-fg text-bg text-xl font-semibold shadow-pop">N</div>
          <h1 className="text-xl font-semibold tracking-tight">Note SPBoucher AI</h1>
          <p className="mt-1 text-sm text-fg-muted">Private workspace · owner access only</p>
        </div>
        <LoginForm next={sp.next ?? "/"} step={s && s.totpEnabled && !s.mfaPassed ? "totp" : "password"} />
        <p className="mt-6 text-center text-[11px] text-fg-faint">Sessions are server-side; 5 failed attempts lock the account for a growing delay.</p>
      </div>
    </main>
  );
}
