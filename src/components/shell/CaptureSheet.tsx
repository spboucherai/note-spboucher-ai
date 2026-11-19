"use client";
import { lumenPulse } from "@/lib/client/motion";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Link2, ListChecks, Mic, Paperclip, Square, X, AudioLines, CloudOff } from "lucide-react";
import { Dialog, SheetContent, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useUI } from "@/lib/client/store";
import { useOnline } from "@/lib/client/hooks";
import { enqueueCapture } from "@/lib/client/outbox";
import { cn } from "@/lib/utils";

type Kind = "note" | "tasks" | "link";
const DRAFT = "note-draft-capture";
const isUrl = (s: string) => /^(https?:\/\/|www\.)\S+$/i.test(s.trim());

/**
 * Quick capture, reachable from anywhere (+ button, ⌘⇧N). One field, no space or template to choose: it lands in the inbox.
 * Text, to-do list, link, camera photo, any file/scan, a voice memo (when the browser can record) and system dictation.
 * Works offline: the capture is stored on the device and sent when the network is back, exactly once.
 */
export function CaptureSheet() {
  const ui = useUI(); const r = useRouter(); const qc = useQueryClient(); const online = useOnline();
  const [kind, setKind] = useState<Kind>("note"); const [text, setText] = useState(""); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<"idle" | "recording">("idle"); const [dictating, setDictating] = useState(false); const [secs, setSecs] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null); const fileInput = useRef<HTMLInputElement>(null); const recorder = useRef<MediaRecorder | null>(null); const speech = useRef<any>(null); const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const canRecord = typeof window !== "undefined" && "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia);
  const Speech = typeof window !== "undefined" ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : null;

  useEffect(() => { if (!ui.captureOpen) return; try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null"); if (d?.text) { setText(d.text); setKind(d.kind ?? "note"); } } catch { /* no draft */ } setTimeout(() => input.current?.focus(), 60); }, [ui.captureOpen]);
  useEffect(() => { if (!ui.captureOpen) return; try { if (text) localStorage.setItem(DRAFT, JSON.stringify({ text, kind })); else localStorage.removeItem(DRAFT); } catch { /* storage full or disabled */ } }, [text, kind, ui.captureOpen]);
  useEffect(() => { if (kind === "note" && isUrl(text)) setKind("link"); }, [text, kind]);
  const stopAll = () => { try { recorder.current?.state === "recording" && recorder.current.stop(); } catch {} try { speech.current?.stop(); } catch {} if (tick.current) clearInterval(tick.current); setRec("idle"); setDictating(false); };
  const close = () => { stopAll(); ui.set({ captureOpen: false }); };

  function pick(accept: string, capture?: boolean) { const el = fileInput.current; if (!el) return; el.accept = accept; if (capture) el.setAttribute("capture", "environment"); else el.removeAttribute("capture"); el.click(); }
  async function record() {
    if (rec === "recording") { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks: BlobPart[] = [];
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); recorder.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); if (tick.current) clearInterval(tick.current); setRec("idle"); const type = (mr.mimeType || "audio/webm").split(";")[0]; const ext = type.includes("mp4") ? "m4a" : "webm"; if (chunks.length) setFiles((f) => [...f, new File(chunks, `voice-memo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, { type })]); };
      mr.start(); setSecs(0); tick.current = setInterval(() => setSecs((s) => s + 1), 1000); setRec("recording");
    } catch (e: any) { toast(e?.name === "NotAllowedError" ? "Microphone access was refused" : "Recording is not available here", { description: e?.name === "NotAllowedError" ? "Allow the microphone for this site in the browser settings, or use the keyboard's dictation key." : undefined, tone: "danger" }); }
  }
  function dictate() {
    if (dictating) { speech.current?.stop(); return; }
    if (!Speech) return;
    try {
      const s = new Speech(); speech.current = s; s.lang = navigator.language || "fr-CA"; s.interimResults = false; s.continuous = true;
      s.onresult = (ev: any) => { let add = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) add += ev.results[i][0].transcript; if (add) setText((t) => (t && !/\s$/.test(t) ? `${t} ` : t) + add.trim()); };
      s.onend = () => setDictating(false); s.onerror = (ev: any) => { setDictating(false); if (ev.error === "not-allowed" || ev.error === "service-not-allowed") toast("Dictation was refused by the browser", { description: "Use the microphone key of the keyboard instead.", tone: "danger" }); };
      s.start(); setDictating(true);
    } catch { setDictating(false); }
  }
  async function save(open = false) {
    const t = text.trim(); if ((!t && !files.length) || busy) return; stopAll(); setBusy(true);
    const k = files.length && !t ? (files.every((f) => f.type.startsWith("image/")) ? "photo" : files.every((f) => f.type.startsWith("audio/")) ? "audio" : "file") : kind === "link" && !isUrl(t.split("\n")[0]) ? "note" : kind;
    const res = await enqueueCapture({ kind: k, text: t || undefined }, files);
    setBusy(false);
    if (!res.sent && res.error && navigator.onLine && !/network|timed out/i.test(res.error)) { toast("Could not capture", { description: res.error, tone: "danger" }); return; } // refused by the server: keep the text on screen
    setText(""); setFiles([]); setKind("note"); try { localStorage.removeItem(DRAFT); } catch {}
    ui.set({ captureOpen: false });
    // 6 Quick Capture: Lumen pulse where the capture was launched from (the + of the phone bar, else the bottom of the screen)
    lumenPulse(document.querySelector(".mobile-nav [aria-label='Quick capture']"));
    if (res.sent) { qc.invalidateQueries({ queryKey: ["inbox"] }); qc.invalidateQueries({ queryKey: ["inbox-count"] }); if (open && res.pageId) r.push(`/p/${res.pageId}`); else toast("Captured to inbox", { tone: "success" }); }
    else toast("Saved on this device", { description: "It will be sent to your inbox as soon as the network is back." });
  }
  const K = ({ id, icon, label }: { id: Kind; icon: React.ReactNode; label: string }) => <button type="button" role="radio" aria-checked={kind === id} onClick={() => { setKind(id); input.current?.focus(); }} className={cn("flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13.5px] font-medium text-fg-muted [&_svg]:size-4", kind === id && "bg-bg-elev text-fg shadow-card")}>{icon}{label}</button>;
  const A = ({ label, icon, onTap, active }: { label: string; icon: React.ReactNode; onTap: () => void; active?: boolean }) => <button type="button" aria-label={label} aria-pressed={active} onClick={onTap} className={cn("grid size-11 shrink-0 place-items-center rounded-xl border border-line text-fg-muted active:bg-bg-sunk [&_svg]:size-5", active && "border-danger/50 bg-danger/10 text-danger")}>{icon}</button>;
  return (
    <Dialog open={ui.captureOpen} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent title="Quick capture" className="capture-sheet" description={online ? "Goes to your inbox. Sort it later." : undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
        {!online && <div className="mb-2 flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-[13px]"><CloudOff className="size-4 shrink-0" />Offline — the capture is kept on this device and sent later.</div>}
        <div role="radiogroup" aria-label="Kind of capture" className="mb-2 flex gap-1 rounded-xl bg-bg-sunk p-1"><K id="note" icon={<FileText />} label="Note" /><K id="tasks" icon={<ListChecks />} label="To-do" /><K id="link" icon={<Link2 />} label="Link" /></div>
        <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} aria-label="Capture text" rows={4} enterKeyHint="enter" placeholder={kind === "tasks" ? "One task per line…" : kind === "link" ? "Paste a link, then a note if you like…" : "Write anything. The first line becomes the title."} inputMode={kind === "link" && !text ? "url" : "text"} className="block max-h-[38dvh] min-h-[7.5rem] w-full resize-none rounded-xl border border-line bg-bg p-3 text-[16px] leading-6 outline-none [field-sizing:content] focus:border-accent/60" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } }} />
        {rec === "recording" && <div role="status" className="mt-2 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger"><AudioLines className="size-4 animate-pulse" />Recording… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}<button type="button" onClick={record} className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 font-medium"><Square className="size-3.5 fill-current" />Stop</button></div>}
        {dictating && <div role="status" className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">Listening… speak, then tap the microphone again.</div>}
        {files.length > 0 && <ul aria-label="Attachments" className="mt-2 flex flex-wrap gap-1.5">{files.map((f, i) => <li key={`${f.name}-${i}`} className="flex h-9 max-w-full items-center gap-1.5 rounded-lg border border-line bg-bg pl-2.5 text-[12.5px]"><span className="max-w-[11rem] truncate">{f.name}</span><span className="text-fg-faint">{f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="grid size-9 place-items-center text-fg-muted"><X className="size-4" /></button></li>)}</ul>}
        <input ref={fileInput} type="file" multiple hidden aria-hidden tabIndex={-1} onChange={(e) => { const add = Array.from(e.target.files ?? []); const big = add.find((f) => f.size > 200 * 1024 * 1024); if (big) toast("File too large", { description: `${big.name} is over 200 MB.`, tone: "danger" }); setFiles((x) => [...x, ...add.filter((f) => f.size <= 200 * 1024 * 1024)]); e.target.value = ""; }} />
        <div className="mt-3 flex items-center gap-2">
          <A label="Take a photo" icon={<Camera />} onTap={() => pick("image/*", true)} />
          <A label="Attach a file, PDF or scan" icon={<Paperclip />} onTap={() => pick("")} />
          {canRecord && <A label={rec === "recording" ? "Stop recording" : "Record a voice memo"} icon={rec === "recording" ? <Square className="fill-current" /> : <AudioLines />} onTap={record} active={rec === "recording"} />}
          {Speech && <A label={dictating ? "Stop dictation" : "Dictate text"} icon={<Mic />} onTap={dictate} active={dictating} />}
          <Button className="ml-auto h-11 px-5 text-[15px]" onClick={() => save()} disabled={busy || (!text.trim() && !files.length)}>{busy && <Spinner className="border-white/40 border-t-white" />}Capture</Button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-fg-faint"><span>{!Speech && !canRecord ? "Tip: the microphone key of your keyboard dictates here." : ""}</span><button type="button" className="h-9 px-1 font-medium text-accent disabled:opacity-40" disabled={busy || !online || (!text.trim() && !files.length)} onClick={() => save(true)}>Capture and open</button></div>
      </SheetContent>
    </Dialog>
  );
}
