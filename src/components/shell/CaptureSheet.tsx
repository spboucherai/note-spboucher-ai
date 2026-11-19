"use client";
/**
 * file: src/components/shell/CaptureSheet.tsx
 * description: quick capture (SPEC §4.12), reachable from anywhere (+ button, ⌘⇧C, a drop on the app, a share, the editor's selection
 *   menu). One field, no space or template to choose: it lands in the inbox. Text, idea, to-do list, link, photo, screenshot pasted
 *   from the clipboard, PDF or any document, a voice memo (recorded with pause/resume, or an audio file), selected text with its source,
 *   and system dictation. Smart paste: an address becomes a link, an image a screenshot, a file a document. Everything goes through the
 *   outbox (`enqueueCapture`): offline, the capture is stored on the device and sent when the network is back, exactly once.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { lumenPulse } from "@/lib/client/motion";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Link2, ListChecks, Mic, Paperclip, Square, X, AudioLines, CloudOff, Lightbulb, Pause, Play, TextQuote, ImageIcon, Share2, Download } from "lucide-react";
import { Dialog, SheetContent, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useUI } from "@/lib/client/store";
import { useOnline } from "@/lib/client/hooks";
import { enqueueCapture } from "@/lib/client/outbox";
import { takePrefill } from "@/lib/client/capture";
import { acceptFiles, captureKind, classifyPaste, formatBytes, isUrl, screenshotName, type CapturePrefill, type Mode, type Origin } from "@/lib/client/capture-logic";
import { cn } from "@/lib/utils";

const DRAFT = "note-draft-capture";
const MODES: Mode[] = ["note", "idea", "tasks", "link"];
function micProblem(e: unknown): { title: string; description?: string } {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return { title: "Microphone access was refused", description: "Allow the microphone for this site in the browser settings, or use the keyboard's dictation key." };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { title: "No microphone was found", description: "Plug one in, or attach an audio file instead." };
  if (name === "NotReadableError" || name === "AbortError") return { title: "The microphone is busy", description: "Another application is using it, or it could not be started." };
  return { title: "Recording is not available here", description: "You can attach an audio file instead." };
}

export function CaptureSheet() {
  const ui = useUI(); const r = useRouter(); const qc = useQueryClient(); const online = useOnline();
  const [kind, setKind] = useState<Mode>("note"); const [text, setText] = useState(""); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState<Origin>(null); const [source, setSource] = useState<{ url?: string; title?: string }>({}); const [notes, setNotes] = useState<string[]>([]);
  const [rec, setRec] = useState<"idle" | "recording" | "paused">("idle"); const [dictating, setDictating] = useState(false); const [secs, setSecs] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null); const fileInput = useRef<HTMLInputElement>(null); const recorder = useRef<MediaRecorder | null>(null); const speech = useRef<any>(null); const tick = useRef<ReturnType<typeof setInterval> | null>(null); const discard = useRef(false);
  const canRecord = typeof window !== "undefined" && "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia);
  const Speech = typeof window !== "undefined" ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : null;

  /** Attach files after the size checks; says why a file was refused and what a large recording implies. */
  const addFiles = (list: File[], from: Origin = null) => {
    const { ok, rejected, notes: n } = acceptFiles(list);
    if (rejected.length) toast(rejected.length === 1 ? "File not attached" : `${rejected.length} files not attached`, { description: rejected.map((x) => x.reason).join(" "), tone: "danger" });
    if (ok.length) { setFiles((x) => [...x, ...ok]); if (from) setOrigin((o) => o ?? from); }
    if (n.length) setNotes((x) => [...new Set([...x, ...n])]);
  };
  const applyPrefill = (p: CapturePrefill) => {
    setText(p.text ?? ""); setKind(p.mode ?? "note"); setFiles([]); setNotes([]); setOrigin(p.origin ?? null); setSource({ url: p.sourceUrl, title: p.sourceTitle });
    if (p.files?.length) addFiles(p.files, p.origin ?? null);
  };
  // Opening: something handed over (drop, share, selection) wins over the saved draft, which is left untouched for the next plain opening.
  useEffect(() => {
    if (!ui.captureOpen) return;
    const p = takePrefill();
    if (p) applyPrefill(p);
    else { try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null"); if (d?.text) { setText(d.text); setKind(MODES.includes(d.kind) ? d.kind : "note"); } } catch { /* no draft */ } }
    setTimeout(() => input.current?.focus(), 60);
    // a second prefill while the sheet is already open (another drop) replaces what is shown
    const again = () => { const q = takePrefill(); if (q) applyPrefill(q); }; window.addEventListener("note:capture-prefill", again); return () => window.removeEventListener("note:capture-prefill", again);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.captureOpen]);
  useEffect(() => { if (!ui.captureOpen || origin) return; try { if (text) localStorage.setItem(DRAFT, JSON.stringify({ text, kind })); else localStorage.removeItem(DRAFT); } catch { /* storage full or disabled */ } }, [text, kind, origin, ui.captureOpen]);
  useEffect(() => { if (kind === "note" && origin !== "selection" && isUrl(text)) setKind("link"); }, [text, kind, origin]);
  const stopAll = (keep = true) => { discard.current = !keep; try { if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); } catch {} try { speech.current?.stop(); } catch {} if (tick.current) { clearInterval(tick.current); tick.current = null; } setRec("idle"); setDictating(false); };
  const reset = () => { setText(""); setFiles([]); setKind("note"); setOrigin(null); setSource({}); setNotes([]); };
  const close = () => { stopAll(!origin); if (origin) reset(); ui.set({ captureOpen: false }); }; // a handed-over capture (selection, drop, share) that is dismissed is forgotten; a typed draft stays

  function pick(accept: string, capture?: boolean) { const el = fileInput.current; if (!el) return; el.accept = accept; if (capture) el.setAttribute("capture", "environment"); else el.removeAttribute("capture"); el.click(); }
  const startTick = () => { if (tick.current) clearInterval(tick.current); tick.current = setInterval(() => setSecs((s) => s + 1), 1000); };
  async function record() {
    if (rec !== "idle") { recorder.current?.stop(); return; }
    if (!canRecord) { const p = micProblem(null); toast(p.title, { description: p.description, tone: "danger" }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks: BlobPart[] = [];
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); recorder.current = mr; discard.current = false;
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); if (tick.current) { clearInterval(tick.current); tick.current = null; } setRec("idle"); if (discard.current) return; const type = (mr.mimeType || "audio/webm").split(";")[0]; const ext = type.includes("mp4") ? "m4a" : "webm"; if (chunks.length) addFiles([new File(chunks, `voice-memo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, { type })]); };
      mr.start(); setSecs(0); startTick(); setRec("recording");
    } catch (e: any) { const p = micProblem(e); toast(p.title, { description: p.description, tone: "danger" }); }
  }
  /** Pause keeps the microphone open but records nothing; the clock stops with it. */
  function pauseResume() {
    const mr = recorder.current; if (!mr) return;
    try { if (mr.state === "recording") { mr.pause(); if (tick.current) { clearInterval(tick.current); tick.current = null; } setRec("paused"); } else if (mr.state === "paused") { mr.resume(); startTick(); setRec("recording"); } } catch { /* a recorder without pause support keeps recording */ }
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
  /** Smart paste: files never reach the text field (image → screenshot, other file → document); a lone address switches to Link. */
  function onPaste(e: React.ClipboardEvent) {
    const dt = e.clipboardData; const pasted = Array.from(dt?.files ?? []); const verdict = classifyPaste({ text: dt?.getData("text/plain") ?? "", files: pasted });
    if (verdict.as === "screenshot") { e.preventDefault(); addFiles(pasted.map((f) => (/^image\.\w+$/i.test(f.name) || !f.name ? new File([f], screenshotName(f.type), { type: f.type }) : f)), "screenshot"); toast("Screenshot attached"); }
    else if (verdict.as === "document" || verdict.as === "audio" || verdict.as === "file") { e.preventDefault(); addFiles(pasted); toast(verdict.as === "audio" ? "Audio attached" : verdict.as === "document" ? "Document attached" : "File attached"); }
    else if (verdict.as === "link" && !text.trim()) { e.preventDefault(); setText(verdict.url); setKind("link"); }
    // plain text: the browser pastes it into the field as usual
  }
  async function save(open = false) {
    const t = text.trim(); if ((!t && !files.length) || busy || rec !== "idle") return; stopAll(); setBusy(true);
    const k = captureKind({ mode: kind, text: t, files, origin });
    const res = await enqueueCapture({ kind: k, text: t || undefined, ...(k === "selection" && source.url ? { url: source.url } : {}) }, files);
    setBusy(false);
    if (!res.sent && res.error && navigator.onLine && !/network|timed out/i.test(res.error)) { toast("Could not capture", { description: res.error, tone: "danger" }); return; } // refused by the server: keep the text on screen
    const wasDraft = !origin; reset(); if (wasDraft) try { localStorage.removeItem(DRAFT); } catch {}
    ui.set({ captureOpen: false });
    // 6 Quick Capture: Lumen pulse where the capture was launched from (the + of the phone bar, else the bottom of the screen)
    lumenPulse(document.querySelector(".mobile-nav [aria-label='Quick capture']"));
    if (res.sent) { qc.invalidateQueries({ queryKey: ["inbox"] }); qc.invalidateQueries({ queryKey: ["inbox-count"] }); if (open && res.pageId) r.push(`/p/${res.pageId}`); else toast("Captured to inbox", { tone: "success" }); }
    else toast("Saved on this device", { description: "It will be sent to your inbox as soon as the network is back." });
  }
  const K = ({ id, icon, label }: { id: Mode; icon: React.ReactNode; label: string }) => <button type="button" role="radio" aria-checked={kind === id} onClick={() => { setKind(id); input.current?.focus(); }} className={cn("flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13.5px] font-medium text-fg-muted [&_svg]:size-4 [&_svg]:shrink-0", kind === id && "bg-bg-elev text-fg shadow-card")}>{icon}<span className="truncate">{label}</span></button>;
  const A = ({ label, icon, onTap, active }: { label: string; icon: React.ReactNode; onTap: () => void; active?: boolean }) => <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onTap} className={cn("grid size-11 shrink-0 place-items-center rounded-xl border border-line text-fg-muted active:bg-bg-sunk [&_svg]:size-5", active && "border-danger/50 bg-danger/10 text-danger")}>{icon}</button>;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`; const empty = !text.trim() && !files.length;
  const ORIGIN: Record<Exclude<Origin, null>, { icon: React.ReactNode; label: string }> = { selection: { icon: <TextQuote />, label: source.title ? `Selected text — ${source.title}` : "Selected text" }, screenshot: { icon: <ImageIcon />, label: "Screenshot from the clipboard" }, share: { icon: <Share2 />, label: "Shared with SP Note" }, drop: { icon: <Download />, label: "Dropped here" } };
  return (
    <Dialog open={ui.captureOpen} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent title="Quick capture" className="capture-sheet" description={online ? "Goes to your inbox. Sort it later." : undefined} onOpenAutoFocus={(e) => e.preventDefault()} onPaste={onPaste} onDragOver={(e) => { if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault(); }} onDrop={(e) => { const dropped = Array.from(e.dataTransfer?.files ?? []); if (dropped.length) { e.preventDefault(); e.stopPropagation(); addFiles(dropped, "drop"); } }}>
        {!online && <div className="mb-2 flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-[13px]"><CloudOff className="size-4 shrink-0" />Offline — the capture is kept on this device and sent later.</div>}
        {origin && <div data-testid="capture-origin" className="mb-2 flex min-w-0 items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent [&_svg]:size-4 [&_svg]:shrink-0">{ORIGIN[origin].icon}<span className="min-w-0 flex-1 truncate">{ORIGIN[origin].label}</span></div>}
        {origin !== "selection" && <div role="radiogroup" aria-label="Kind of capture" className="mb-2 flex gap-1 rounded-xl bg-bg-sunk p-1"><K id="note" icon={<FileText />} label="Note" /><K id="idea" icon={<Lightbulb />} label="Idea" /><K id="tasks" icon={<ListChecks />} label="To-do" /><K id="link" icon={<Link2 />} label="Link" /></div>}
        <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} aria-label="Capture text" rows={4} enterKeyHint="enter" placeholder={origin === "selection" ? "The selected text…" : kind === "tasks" ? "One task per line…" : kind === "link" ? "Paste a link, then a note if you like…" : kind === "idea" ? "An idea, before it goes. The first line becomes the title." : "Write or paste anything. The first line becomes the title."} inputMode={kind === "link" && !text ? "url" : "text"} className="block max-h-[38dvh] min-h-[7.5rem] w-full resize-none rounded-xl border border-line bg-bg p-3 text-[16px] leading-6 outline-none [field-sizing:content] focus:border-accent/60" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } }} />
        {rec !== "idle" && <div role="status" className={cn("mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]", rec === "paused" ? "bg-bg-sunk text-fg-muted" : "bg-danger/10 text-danger")}><AudioLines className={cn("size-4", rec === "recording" && "motion-safe:animate-pulse")} /><span>{rec === "paused" ? "Paused" : "Recording…"} {clock}</span>
          <button type="button" onClick={pauseResume} className="ml-auto flex h-9 items-center gap-1 rounded-md px-2 font-medium">{rec === "paused" ? <><Play className="size-3.5 fill-current" />Resume</> : <><Pause className="size-3.5 fill-current" />Pause</>}</button>
          <button type="button" onClick={record} className="flex h-9 items-center gap-1 rounded-md px-2 font-medium"><Square className="size-3.5 fill-current" />Stop</button></div>}
        {dictating && <div role="status" className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">Listening… speak, then tap the microphone again.</div>}
        {files.length > 0 && <ul aria-label="Attachments" className="mt-2 flex flex-wrap gap-1.5">{files.map((f, i) => <li key={`${f.name}-${i}`} className="flex h-9 max-w-full items-center gap-1.5 rounded-lg border border-line bg-bg pl-2.5 text-[12.5px]"><span className="max-w-[11rem] truncate">{f.name}</span><span className="text-fg-muted">{formatBytes(f.size)}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => { setFiles((x) => x.filter((_, j) => j !== i)); setNotes((n) => n.filter((m) => !m.startsWith(`${f.name} `))); }} className="grid size-9 place-items-center text-fg-muted"><X className="size-4" /></button></li>)}</ul>}
        {notes.map((n) => <p key={n} role="note" className="mt-1.5 text-[12.5px] leading-5 text-fg-muted">{n}</p>)}
        <input ref={fileInput} type="file" multiple hidden aria-hidden tabIndex={-1} onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <div className="mt-3 flex items-center gap-2">
          <A label="Take a photo" icon={<Camera />} onTap={() => pick("image/*", true)} />
          <A label="Attach a file, PDF or scan" icon={<Paperclip />} onTap={() => pick("")} />
          {canRecord && <A label={rec !== "idle" ? "Stop recording" : "Record a voice memo"} icon={rec !== "idle" ? <Square className="fill-current" /> : <AudioLines />} onTap={record} active={rec !== "idle"} />}
          {Speech && <A label={dictating ? "Stop dictation" : "Dictate text"} icon={<Mic />} onTap={dictate} active={dictating} />}
          <Button className="ml-auto h-11 px-5 text-[15px]" onClick={() => save()} disabled={busy || empty || rec !== "idle"}>{busy && <Spinner className="border-white/40 border-t-white" />}Capture</Button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-fg-muted"><span className="min-w-0">{!Speech && !canRecord ? "Tip: the microphone key of your keyboard dictates here." : rec !== "idle" ? "Stop the recording to capture it." : "Paste a link, an image or a file — it is recognised."}</span><button type="button" className="h-9 shrink-0 px-1 font-medium text-accent disabled:opacity-40" disabled={busy || !online || empty || rec !== "idle"} onClick={() => save(true)}>Capture and open</button></div>
      </SheetContent>
    </Dialog>
  );
}
