"use client";
/**
 * Phone-appropriate file preview. An <iframe>/<object> PDF inside a sheet is unreliable on iOS (first page only, no zoom, no scroll), so a
 * file is never embedded: "Open" hands it to the browser's native viewer in a new tab, "Download" saves it, and "Share" passes the file
 * itself to the system share sheet (Files, AirDrop, a PDF reader…) when the browser can share files.
 */
import * as React from "react";
import { Download, ExternalLink, Share2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { TButton } from "./ui";

const SHARE_MAX = 100 * 1024 * 1024;
/** True when `navigator.share` accepts files on this device (checked after mount: it depends on the browser, not on the viewport). */
export function useCanShareFiles(): boolean {
  const [ok, setOk] = React.useState(false);
  React.useEffect(() => { try { setOk(typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] })); } catch { setOk(false); } }, []);
  return ok;
}
const linkBtn = (variant: "outline" | "default" = "outline") => cn(buttonVariants({ variant, size: "sm" }), "h-11 px-3.5 md:h-8 md:px-2.5");

export function FileActions({ id, filename, mime, size, primaryOpen, className }: { id: string; filename: string; mime?: string | null; size?: number | null; primaryOpen?: boolean; className?: string }) {
  const canShare = useCanShareFiles(); const url = `/api/files/${id}`;
  const [state, setState] = React.useState<"idle" | "loading" | "ready">("idle"); const fileRef = React.useRef<File | null>(null); const ctl = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => ctl.current?.abort(), []);
  React.useEffect(() => { fileRef.current = null; setState("idle"); }, [id]);
  async function share() {
    try {
      if (!fileRef.current) {
        // the file has to be in memory to be shared; fetching it can outlive the tap's "user activation", hence the second tap below
        setState("loading"); ctl.current = new AbortController();
        const res = await fetch(url, { credentials: "same-origin", signal: ctl.current.signal }); if (!res.ok) throw new Error(res.status === 410 ? "The file is missing on the server." : `Could not load the file (${res.status}).`);
        const blob = await res.blob(); fileRef.current = new File([blob], filename, { type: mime || blob.type || "application/octet-stream" }); setState("ready");
      }
      const data = { files: [fileRef.current], title: filename };
      if (!navigator.canShare?.(data)) { toast("This file cannot be shared from this browser", { description: "Use Download instead.", tone: "danger" }); return; }
      await navigator.share(data);
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "AbortError") return; // sheet dismissed or request cancelled
      if (name === "NotAllowedError" && fileRef.current) { toast("Ready to share", { description: "Tap Share once more to open the share sheet." }); return; }
      setState(fileRef.current ? "ready" : "idle"); toast("Could not share the file", { description: (e as Error)?.message, tone: "danger", action: { label: "Retry", run: share } });
    }
  }
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <a href={url} target="_blank" rel="noopener noreferrer" className={linkBtn(primaryOpen ? "default" : "outline")}><ExternalLink /> Open</a>
      <a href={url} download={filename} className={linkBtn()}><Download /> Download</a>
      {canShare && (size ?? 0) <= SHARE_MAX && <TButton variant="outline" onClick={share} disabled={state === "loading"} aria-busy={state === "loading"}>{state === "loading" ? <Spinner className="size-3.5" /> : <Share2 />} {state === "loading" ? "Preparing…" : state === "ready" ? "Share now" : "Share"}</TButton>}
    </div>
  );
}
