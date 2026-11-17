"use client";
import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
export function OfflineScreen() {
  const [online, setOnline] = useState(false);
  useEffect(() => { const back = () => { setOnline(true); const to = sessionStorage.getItem("note-offline-from") || "/"; setTimeout(() => window.location.replace(to), 400); }; if (window.location.pathname !== "/offline") try { sessionStorage.setItem("note-offline-from", window.location.pathname + window.location.search); } catch {} window.addEventListener("online", back); return () => window.removeEventListener("online", back); }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center safe-top safe-bottom">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-bg-sunk text-fg-muted"><CloudOff className="size-7" /></div>
        <h1 className="text-[19px] font-semibold">{online ? "Back online…" : "You are offline"}</h1>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">Your notes are not stored on this device, so they cannot be shown without a connection. Text you were typing and captures made offline are kept here and are sent as soon as the network returns.</p>
        <button onClick={() => window.location.reload()} className="mt-5 h-11 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg">Try again</button>
      </div>
    </main>
  );
}
