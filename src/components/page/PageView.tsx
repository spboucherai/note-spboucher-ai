"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor as TEditor } from "@tiptap/react";
import { Editor } from "@/components/editor/Editor";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { Clock, Link2, MoreHorizontal, Trash2, RotateCcw, Image as ImageIcon, Smile, Star, Copy, Download, History, FileDown, Sparkles, Check } from "lucide-react";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Dialog, DialogContent, Badge, Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { timeAgo, cn, debounce } from "@/lib/utils";
import { markdownToDoc } from "@/lib/editor/markdown-client";
import { useUI } from "@/lib/client/store";
import { DatabaseView } from "@/components/database/DatabaseView";
import { PageProperties } from "@/components/page/PageProperties";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import dynamic from "next/dynamic";
const PageGraphCard = dynamic(() => import("@/components/graph/PageGraphCard").then((m) => m.PageGraphCard), { ssr: false });

const EMOJI = ["📄", "📝", "📚", "🔬", "🧠", "💡", "📊", "📈", "🗂", "🧪", "🏠", "🏦", "📐", "🧮", "🗓", "✅", "🚀", "⭐", "🔥", "🎯", "🧭", "🗺", "💬", "🤖", "🧩", "📎", "🔐", "🌍", "🏛", "🎓"];
export function PageView({ page, breadcrumb, backlinks }: { page: any; breadcrumb: { id: string; title: string; icon: string | null }[]; backlinks: any[] }) {
  const r = useRouter(); const qc = useQueryClient(); const ui = useUI();
  const [title, setTitle] = useState(page.title === "Untitled" ? "" : page.title); const [icon, setIcon] = useState<string | null>(page.icon); const [cover, setCover] = useState<string | null>(page.cover);
  const [status, setStatus] = useState<"saved" | "saving" | "error" | "offline">("saved"); const [versions, setVersions] = useState<any[] | null>(null); const [preview, setPreview] = useState<any | null>(null);
  const editorRef = useRef<TEditor | null>(null); const pending = useRef<any>(null); const inflight = useRef(false);
  const flush = useCallback(async () => {
    if (!pending.current || inflight.current) return; const patch = pending.current; pending.current = null; inflight.current = true; setStatus("saving");
    try { await api(`/api/pages/${page.id}`, { method: "PATCH", json: patch }); setStatus("saved"); if (patch.title !== undefined || patch.icon !== undefined) qc.invalidateQueries({ queryKey: ["tree"] }); }
    catch (e: any) { pending.current = { ...patch, ...(pending.current ?? {}) }; setStatus(navigator.onLine ? "error" : "offline"); try { localStorage.setItem(`note-pending-${page.id}`, JSON.stringify(pending.current)); } catch {} }
    finally { inflight.current = false; if (pending.current) setTimeout(flush, 1500); }
  }, [page.id, qc]);
  const schedule = useRef(debounce(flush, 800)).current;
  const queue = useCallback((patch: any) => { pending.current = { ...(pending.current ?? {}), ...patch }; setStatus("saving"); schedule(); }, [schedule]);
  useEffect(() => { const h = () => { if (pending.current) { navigator.sendBeacon?.(`/api/pages/${page.id}/beacon`, JSON.stringify(pending.current)); } }; window.addEventListener("pagehide", h); const online = () => flush(); window.addEventListener("online", online); return () => { window.removeEventListener("pagehide", h); window.removeEventListener("online", online); flush(); }; }, [flush, page.id]);
  useEffect(() => { try { const saved = localStorage.getItem(`note-pending-${page.id}`); if (saved) { localStorage.removeItem(`note-pending-${page.id}`); pending.current = JSON.parse(saved); flush(); } } catch {} }, [page.id, flush]);
  useEffect(() => { const h = (e: Event) => { const md = (e as CustomEvent).detail as string; const ed = editorRef.current; if (!ed) return; ed.chain().focus("end").insertContent([{ type: "aiBlock", attrs: { model: "assistant", at: new Date().toISOString() }, content: markdownToDoc(md) }]).run(); toast("Inserted into page"); }; window.addEventListener("note:insert-markdown", h); return () => window.removeEventListener("note:insert-markdown", h); }, []);
  useEffect(() => { if (location.hash.startsWith("#block-")) setTimeout(() => { const el = document.getElementById(location.hash.slice(1)); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("bg-accent-soft"); setTimeout(() => el.classList.remove("bg-accent-soft"), 2000); } }, 300); }, []);
  async function loadVersions() { setVersions(await api(`/api/pages/${page.id}/versions`)); }
  async function restore(v: number) { await api(`/api/pages/${page.id}/versions`, { method: "POST", json: { version: v } }); toast(`Restored version ${v}`); r.refresh(); setVersions(null); setPreview(null); }
  const isTrashed = Boolean(page.deletedAt); const isDb = page.type === "database";
  return (
    <div className="mx-auto w-full max-w-[52rem] px-5 pb-32 pt-2 md:px-10 md:pt-4 lg:max-w-[56rem]">
      {cover && <div className="group relative -mx-5 mb-4 h-40 md:-mx-10 md:h-56"><img src={cover} alt="" className="h-full w-full object-cover md:rounded-xl" /><button onClick={() => { setCover(null); queue({ cover: null }); }} className="absolute right-3 top-3 rounded-md bg-black/50 px-2 py-1 text-[11px] text-white opacity-0 group-hover:opacity-100">Remove cover</button></div>}
      <div className="flex items-center gap-1 text-[12px] text-fg-faint">
        {breadcrumb.slice(0, -1).map((b) => <span key={b.id} className="flex items-center gap-1"><Link href={`/p/${b.id}`} className="hover:text-fg">{b.icon} {b.title}</Link><span>/</span></span>)}
        <span className="text-fg-muted">{title || "Untitled"}</span>
        <span className="ml-auto flex items-center gap-1">
          <span className={cn("flex items-center gap-1", status === "saved" && "text-fg-faint", status === "saving" && "text-fg-muted", status === "error" && "text-danger", status === "offline" && "text-warning")}>{status === "saved" ? <Check className="size-3" /> : status === "saving" ? <span className="size-2 animate-pulse rounded-full bg-fg-faint" /> : null}{status === "saved" ? `Saved · ${timeAgo(page.updatedAt)}` : status === "saving" ? "Saving…" : status === "offline" ? "Offline — will retry" : "Save failed — retrying"}</span>
          <Badge tone="neutral">{page.wordCount} words</Badge>
          <button onClick={() => ui.openAI({ pageId: page.id })} className="hidden h-7 items-center gap-1 rounded-md px-2 text-ai hover:bg-ai-soft md:flex"><Sparkles className="size-3.5" />Ask</button>
          <Menu><MenuTrigger asChild><button className="grid size-7 place-items-center rounded-md hover:bg-bg-sunk"><MoreHorizontal className="size-4" /></button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={async () => { await api(`/api/pages/${page.id}`, { method: "PATCH", json: { pinned: !page.pinned } }); qc.invalidateQueries({ queryKey: ["tree"] }); r.refresh(); }}><Star /> {page.pinned ? "Unpin" : "Pin"}</MenuItem>
              <MenuItem onSelect={loadVersions}><History /> Version history</MenuItem>
              <MenuItem onSelect={async () => { const p = await api(`/api/pages/${page.id}?action=duplicate`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); }}><Copy /> Duplicate</MenuItem>
              <MenuItem onSelect={() => window.open(`/api/export?format=md&pageId=${page.id}`, "_blank")}><FileDown /> Export Markdown</MenuItem>
              <MenuItem onSelect={() => window.open(`/api/export?format=pdf&pageId=${page.id}`, "_blank")}><Download /> Print / PDF</MenuItem>
              <MenuSeparator />
              {isTrashed ? <MenuItem onSelect={async () => { await api(`/api/pages/${page.id}?action=restore`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.refresh(); }}><RotateCcw /> Restore</MenuItem> : <MenuItem danger onSelect={async () => { await api(`/api/pages/${page.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Moved to trash"); r.push("/"); }}><Trash2 /> Move to trash</MenuItem>}
            </MenuContent></Menu>
        </span>
      </div>
      {isTrashed && <div className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]"><Trash2 className="size-4 text-danger" /> This page is in the trash.<Button size="xs" variant="outline" className="ml-auto" onClick={async () => { await api(`/api/pages/${page.id}?action=restore`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.refresh(); }}>Restore</Button><Button size="xs" variant="danger" onClick={async () => { await api(`/api/pages/${page.id}?purge=1`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.push("/trash"); }}>Delete forever</Button></div>}
      <div className="group/head mt-6">
        <div className="flex items-center gap-2 text-[12px] text-fg-faint opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
          {!icon && <Popover><PopoverTrigger asChild><button className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-sunk"><Smile className="size-3.5" /> Add icon</button></PopoverTrigger><PopoverContent className="w-64"><div className="grid grid-cols-8 gap-1">{EMOJI.map((e) => <button key={e} className="grid size-7 place-items-center rounded text-lg hover:bg-bg-sunk" onClick={() => { setIcon(e); queue({ icon: e }); }}>{e}</button>)}</div></PopoverContent></Popover>}
          {!cover && <button className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-sunk" onClick={() => { const url = window.prompt("Cover image URL"); if (url) { setCover(url); queue({ cover: url }); } }}><ImageIcon className="size-3.5" /> Add cover</button>}
        </div>
        <div className="flex items-start gap-3">
          {icon && <Popover><PopoverTrigger asChild><button className="mt-1 text-4xl leading-none hover:opacity-80">{icon}</button></PopoverTrigger><PopoverContent className="w-64"><div className="grid grid-cols-8 gap-1">{EMOJI.map((e) => <button key={e} className="grid size-7 place-items-center rounded text-lg hover:bg-bg-sunk" onClick={() => { setIcon(e); queue({ icon: e }); }}>{e}</button>)}</div><button className="mt-2 text-[12px] text-fg-muted hover:text-fg" onClick={() => { setIcon(null); queue({ icon: null }); }}>Remove icon</button></PopoverContent></Popover>}
          <textarea value={title} onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }} placeholder="Untitled" rows={1} disabled={isTrashed} className="w-full resize-none bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-fg-faint md:text-4xl" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editorRef.current?.commands.focus("start"); } }} onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }} />
        </div>
      </div>
      {page.databaseId && <RowBanner databaseId={page.databaseId} />}
      <PageProperties page={page} onChange={(props) => queue({ properties: props })} />
      {page.type === "research" && <ResearchPanel pageId={page.id} />}
      {isDb ? (
        <div className="mt-4"><DatabaseView pageId={page.id} /></div>
      ) : (
        <div className="mt-3">
          <Editor content={page.content} pageId={page.id} editable={!isTrashed} autofocus={!title} onReady={(e) => (editorRef.current = e)} onChange={(doc) => queue({ content: doc })} />
        </div>
      )}
      {!isTrashed && <div className="mt-12 border-t border-line pt-4"><div className="mb-2 text-[12px] font-medium text-fg-muted">Connections</div><PageGraphCard pageId={page.id} /></div>}
      {backlinks.length > 0 && <div className="mt-6 border-t border-line pt-4"><div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-fg-muted"><Link2 className="size-3.5" /> {backlinks.length} backlink{backlinks.length > 1 ? "s" : ""}</div><div className="flex flex-wrap gap-1.5">{backlinks.map((b) => <Link key={b.id} href={`/p/${b.id}`} className="rounded-md border border-line px-2 py-1 text-[13px] hover:bg-bg-sunk">{b.icon ?? "📄"} {b.title}</Link>)}</div></div>}
      <Dialog open={versions !== null} onOpenChange={(o) => { if (!o) { setVersions(null); setPreview(null); } }}>
        <DialogContent title="Version history" description="Snapshots are kept every 20 saves, every 10 minutes of editing, and before each restore (max 200)." wide>
          <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
            <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">{versions?.length ? versions.map((v) => <button key={v.id} onClick={async () => setPreview(await api(`/api/pages/${page.id}/versions?v=${v.version}`))} className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-bg-sunk", preview?.version === v.version && "bg-bg-sunk")}><span className="text-[13px] font-medium">v{v.version} · {v.title}</span><span className="text-[11px] text-fg-faint"><Clock className="mr-1 inline size-3" />{timeAgo(v.createdAt)} · {v.reason} · {v.wordCount} words</span></button>) : <div className="p-3 text-[13px] text-fg-muted">No snapshots yet.</div>}</div>
            <div className="min-h-[200px] rounded-lg border border-line bg-bg p-3">{preview ? <><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">{preview.title}</span><Button size="xs" onClick={() => restore(preview.version)}><RotateCcw /> Restore v{preview.version}</Button></div><div className="max-h-[50vh] overflow-y-auto"><Editor content={preview.content} editable={false} /></div></> : <div className="grid h-full place-items-center text-[13px] text-fg-muted">Select a version to preview</div>}</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowBanner({ databaseId }: { databaseId: string }) {
  const [db, setDb] = useState<any>(null);
  useEffect(() => { api(`/api/databases/${databaseId}`).then(setDb).catch(() => {}); }, [databaseId]);
  return <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-sunk px-3 py-2 text-[12px] text-fg-muted"><span>Row of database</span>{db ? <Link href={`/p/${db.pageId}`} className="font-medium text-fg hover:underline">{db.icon ?? "🗂"} {db.name}</Link> : <span className="pulse-soft">…</span>}<span className="ml-auto">Properties are edited in the database (side peek).</span></div>;
}
