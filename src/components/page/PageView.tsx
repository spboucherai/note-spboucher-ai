"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor as TEditor } from "@tiptap/react";
import { Editor, getEditorDoc, setEditorDoc, type EditorLock } from "@/components/editor/Editor";
import { registerCommands } from "@/lib/client/commands";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { Clock, Link2, MoreHorizontal, Trash2, RotateCcw, Image as ImageIcon, Smile, Star, Copy, Download, History, FileDown, Sparkles, Check, CloudOff, TriangleAlert, GitCompareArrows, RefreshCw, Archive, Inbox, Tag, X } from "lucide-react";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Dialog, DialogContent, SheetContent, Popover, PopoverTrigger, PopoverContent, Spinner } from "@/components/ui/primitives";
import { usePageSync, type ServerCopy } from "@/lib/client/page-sync";
import { withFreshAuth } from "@/lib/client/passkey";
import { Button } from "@/components/ui/button";
import { timeAgo, cn } from "@/lib/utils";
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
  const [versions, setVersions] = useState<any[] | null>(null); const [preview, setPreview] = useState<any | null>(null); const [compare, setCompare] = useState(false); const [resolving, setResolving] = useState<string | null>(null);
  const [pinned, setPinned] = useState<boolean>(page.pinned); const [tags, setTags] = useState<string[] | null>(null); const [tagOpen, setTagOpen] = useState(false); const [tagDraft, setTagDraft] = useState("");
  const editorRef = useRef<TEditor | null>(null); const lockRef = useRef<EditorLock | null>(null); const titleRef = useRef(title); titleRef.current = title; const docRef = useRef<any>(page.content); const restored = useRef<any>(null); const editorSynced = useRef(false);
  const sync = usePageSync(page, {
    // a locked editor (newer content it cannot hold) is never the source of what gets saved: the copy received from the server is
    current: () => ({ title: titleRef.current, content: !lockRef.current && editorRef.current ? getEditorDoc(editorRef.current) : docRef.current }),
    applyRemote: (c: ServerCopy) => { setTitle(c.title === "Untitled" ? "" : c.title); docRef.current = c.content; restored.current = c.content; const ed = editorRef.current; if (ed) { setEditorDoc(ed, c.content); editorSynced.current = true; } },
    onSaved: (patch) => { if (patch.title !== undefined || patch.icon !== undefined) qc.invalidateQueries({ queryKey: ["tree"] }); },
    onDraftRestored: () => toast("Unsaved changes restored", { description: "Text typed before the last interruption was recovered from this device." }),
  });
  const { status, queue } = sync;
  useEffect(() => { const h = () => toast("Updated", { description: "This note was changed in another session; you now see the latest version." }); window.addEventListener("note:remote-update", h); return () => window.removeEventListener("note:remote-update", h); }, []);
  useEffect(() => { api<string[]>(`/api/pages/${page.id}/tags`).then(setTags).catch(() => setTags([])); }, [page.id]);
  async function saveTags(next: string[]) { const prev = tags; setTags(next); try { setTags(await api<string[]>(`/api/pages/${page.id}/tags`, { method: "PUT", json: { tags: next } })); } catch (e: any) { setTags(prev); toast("Could not save tags", { description: e.message, tone: "danger" }); } }
  async function settle(choice: "mine" | "theirs" | "both") {
    setResolving(choice);
    try { const r = await sync.resolve(choice); setCompare(false); toast(choice === "mine" ? "Your version was kept" : choice === "theirs" ? "The other version was kept" : "Both kept", { description: choice === "both" ? "Your text is in a new page “… (conflict copy)”." : "The other copy is in the version history.", tone: "success" }); if (r.copyId) qc.invalidateQueries({ queryKey: ["tree"] }); }
    catch (e: any) { toast("Could not resolve", { description: e.message, tone: "danger" }); } finally { setResolving(null); }
  }
  // Content pushed into the page from a panel. AI answers arrive as a string and are wrapped in an AI block (provenance stays visible);
  // the owner's own material (reference extracts, LaTeX snippets) arrives as { markdown, plain: true } and is inserted as ordinary blocks.
  useEffect(() => { const h = (e: Event) => { const d = (e as CustomEvent).detail as string | { markdown: string; plain?: boolean }; const md = typeof d === "string" ? d : d?.markdown; const plain = typeof d !== "string" && Boolean(d?.plain); const ed = editorRef.current; if (!ed || !md) return; const blocks = markdownToDoc(md); ed.chain().focus("end").insertContent(plain ? blocks : [{ type: "aiBlock", attrs: { model: "assistant", at: new Date().toISOString() }, content: blocks }]).run(); toast("Inserted into page"); }; window.addEventListener("note:insert-markdown", h); return () => window.removeEventListener("note:insert-markdown", h); }, []);
  // Deep link to a paragraph (search result, citation): wait for the editor to render, then centre and flash the block.
  useEffect(() => {
    if (!location.hash.startsWith("#block-")) return; const id = location.hash.slice(1); let tries = 0; let done = false;
    const t = setInterval(() => { let el = document.getElementById(id); if (el) { done = true; const hl = (new URLSearchParams(location.search).get("hl") ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2); if (hl.length) { /* the anchor is the first block of the indexed passage: walk on to the paragraph that actually holds the words */ for (let n: Element | null = el, i = 0; n && i < 40; n = n.nextElementSibling, i++) { const txt = (n.textContent ?? "").toLowerCase(); if (hl.some((w) => txt.includes(w))) { el = n as HTMLElement; break; } } } clearInterval(t); const target = el; target.scrollIntoView({ block: "center" }); /* Web Animations, not a class: ProseMirror owns the attributes of its nodes and would strip it */ try { const c = getComputedStyle(target).getPropertyValue("--accent-soft").trim() || "rgba(80,110,255,.18)"; target.animate([{ backgroundColor: c, boxShadow: `0 0 0 6px ${c}` }, { backgroundColor: c, boxShadow: `0 0 0 6px ${c}`, offset: 0.7 }, { backgroundColor: "transparent", boxShadow: "0 0 0 6px transparent" }], { duration: 2600, easing: "ease-out" }); } catch { /* no animation support */ } } else if (++tries > 25) { clearInterval(t); if (!done) toast("That paragraph was edited or removed", { description: "The page is shown from the top." }); } }, 120);
    return () => clearInterval(t);
  }, []);
  // Universal Command Center: page-level commands exist while this page is on screen.
  useEffect(() => registerCommands([
    { id: "page.versions", group: "Page", title: "Version history", keywords: "history versions restore snapshot", icon: "history", run: () => { void loadVersions(); } },
    { id: "page.tags", group: "Page", title: "Edit tags", keywords: "tags labels", icon: "tag", run: () => setTagOpen(true) },
    { id: "page.export.md", group: "Page", title: "Export as Markdown", keywords: "export markdown download", icon: "file-down", run: () => { window.open(`/api/export?format=md&pageId=${page.id}`, "_blank"); } },
    { id: "page.export.pdf", group: "Page", title: "Print / PDF", keywords: "export print pdf", icon: "download", run: () => { window.open(`/api/export?format=pdf&pageId=${page.id}`, "_blank"); } },
    { id: "page.ask", group: "AI", title: "Ask about this page", keywords: "ai assistant question", icon: "sparkles", run: () => ui.openAI({ pageId: page.id }) },
    { id: "page.side", group: "View", title: "Open this page to the side", keywords: "split side pane second editor", icon: "panel-right", when: () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches, run: () => ui.openPanel("page", page.id) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [page.id]);
  async function loadVersions() { setVersions(await api(`/api/pages/${page.id}/versions`)); }
  async function restore(v: number) { await sync.flush(); const res = await api<{ version: number }>(`/api/pages/${page.id}/versions`, { method: "POST", json: { version: v } }); toast("Version restored", { description: "The previous state was saved to the history first." }); setVersions(null); setPreview(null); window.location.reload(); void res; }
  const isTrashed = Boolean(page.deletedAt); const isDb = page.type === "database";
  return (
    <div className={cn("page-col mx-auto w-full min-w-0 px-4 pb-40 pt-2 sm:px-5 md:px-10 md:pb-32 md:pt-4", isDb ? "max-w-[84rem]" : "max-w-[50rem]")}>
      {cover && <div className="group relative -mx-5 mb-2 mt-1 h-36 overflow-hidden sm:h-44 md:-mx-6 md:h-52 md:rounded-2xl">{cover.startsWith("preset:") ? <div className={cn("h-full w-full", `cover-${cover.slice(7)}`)} /> : <img src={cover} alt="" className="h-full w-full object-cover" />}<div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"><CoverPicker onPick={(c) => { setCover(c); queue({ cover: c }); }} label="Change" /><button onClick={() => { setCover(null); queue({ cover: null }); }} className="rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white backdrop-blur hover:bg-black/60">Remove</button></div></div>}
      <div className="flex min-h-8 items-center gap-1 text-[12px] text-fg-faint">
        <span className="flex min-w-0 items-center gap-1 md:hidden">{breadcrumb.slice(0, -1).map((b) => <span key={b.id} className="flex min-w-0 items-center gap-1"><Link href={`/p/${b.id}`} className="truncate hover:text-fg">{b.icon} {b.title}</Link><span>/</span></span>)}<span className="truncate text-fg-muted">{title || "Untitled"}</span></span>
        <span className="ml-auto flex items-center gap-1">
          <span role="status" aria-live="polite" className={cn("flex min-h-8 items-center gap-1.5 rounded-full px-2 text-[12px]", status === "saved" && "text-fg-faint", status === "saving" && "text-fg-muted", status === "error" && "bg-danger/10 text-danger", status === "offline" && "bg-warning/15 text-fg", status === "conflict" && "bg-danger/10 text-danger")}>
            {status === "saved" ? <Check className="size-3.5" /> : status === "saving" ? <span className="lumen-dot animate-pulse" /> : status === "offline" ? <CloudOff className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
            <span>{status === "saved" ? <>Saved<span className="max-[380px]:hidden"> · {timeAgo(sync.savedAt)}</span></> : status === "saving" ? "Saving…" : status === "offline" ? "Offline · kept on this device" : status === "conflict" ? "Conflict" : "Not saved"}</span>
            {(status === "offline" || status === "error") && <button onClick={sync.retry} className="-mr-1 flex h-8 items-center gap-1 rounded-full px-2 font-medium underline-offset-2 hover:underline"><RefreshCw className="size-3.5" />Retry</button>}
          </span>
          <span className="hidden tabular-nums sm:inline">· {page.wordCount} words</span>
          <button onClick={() => ui.openAI({ pageId: page.id })} className="ml-1 hidden h-7 items-center gap-1 rounded-md px-2 font-medium text-ai hover:bg-ai-soft md:flex"><Sparkles className="size-3.5" />Ask about this page</button>
          <Menu><MenuTrigger asChild><button aria-label="Page menu" className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"><MoreHorizontal className="size-4" /></button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={async () => { const next = !pinned; setPinned(next); try { await api(`/api/pages/${page.id}`, { method: "PATCH", json: { pinned: next } }); qc.invalidateQueries({ queryKey: ["tree"] }); toast(next ? "Added to favourites" : "Removed from favourites"); } catch (e: any) { setPinned(!next); toast("Could not update", { description: e.message, tone: "danger" }); } }}><Star /> {pinned ? "Remove from favourites" : "Add to favourites"}</MenuItem>
              <MenuItem onSelect={() => setTagOpen(true)}><Tag /> Tags</MenuItem>
              <MenuItem onSelect={() => ui.openAI({ pageId: page.id })} className="md:hidden"><Sparkles /> Ask about this page</MenuItem>
              <MenuItem onSelect={loadVersions}><History /> Version history</MenuItem>
              <MenuItem onSelect={async () => { const p = await api(`/api/pages/${page.id}?action=duplicate`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); }}><Copy /> Duplicate</MenuItem>
              <MenuItem onSelect={() => window.open(`/api/export?format=md&pageId=${page.id}`, "_blank")}><FileDown /> Export Markdown</MenuItem>
              <MenuItem onSelect={() => window.open(`/api/export?format=pdf&pageId=${page.id}`, "_blank")}><Download /> Print / PDF</MenuItem>
              {!isTrashed && <MenuItem onSelect={async () => { await sync.flush(); await api(`/api/pages/${page.id}`, { method: "PATCH", json: { archived: !page.archived } }); qc.invalidateQueries({ queryKey: ["tree"] }); toast(page.archived ? "Back in the workspace" : "Archived", { description: page.archived ? undefined : "Find it again with search or in Archive." }); r.refresh(); if (!page.archived) r.push("/"); }}><Archive /> {page.archived ? "Unarchive" : "Archive"}</MenuItem>}
              <MenuSeparator />
              {isTrashed ? <MenuItem onSelect={async () => { await api(`/api/pages/${page.id}?action=restore`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.refresh(); }}><RotateCcw /> Restore</MenuItem> : <MenuItem danger onSelect={async () => { await sync.flush(); await api(`/api/pages/${page.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Moved to trash"); r.push("/"); }}><Trash2 /> Move to trash</MenuItem>}
            </MenuContent></Menu>
        </span>
      </div>
      {isTrashed && <div className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]"><Trash2 className="size-4 text-danger" /> This page is in the trash.<Button size="xs" variant="outline" className="ml-auto" onClick={async () => { await api(`/api/pages/${page.id}?action=restore`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.refresh(); }}>Restore</Button><Button size="xs" variant="danger" onClick={async () => { if (!window.confirm("Delete this page forever? This cannot be undone.")) return; try { await withFreshAuth(() => api(`/api/pages/${page.id}?purge=1`, { method: "DELETE" })); qc.invalidateQueries({ queryKey: ["tree"] }); r.push("/trash"); } catch (e: any) { toast("Not deleted", { description: e.message, tone: "danger" }); } }}>Delete forever</Button></div>}
      {sync.conflict && <div role="alert" className="mt-3 rounded-xl border border-danger/35 bg-danger/10 p-3 text-[13.5px] leading-5">
        <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /><div className="min-w-0"><div className="font-semibold">This note was also changed in another session</div><div className="text-fg-muted">Nothing was overwritten. Your text is safe on this device. Choose what to keep — the other copy always stays in the version history.</div></div></div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button size="sm" variant="outline" className="h-10 sm:h-8" onClick={() => setCompare(true)}><GitCompareArrows /> Compare</Button>
          <Button size="sm" className="h-10 sm:h-8" disabled={!!resolving} onClick={() => settle("mine")}>{resolving === "mine" && <Spinner className="border-white/40 border-t-white" />}Keep mine</Button>
          <Button size="sm" variant="outline" className="h-10 sm:h-8" disabled={!!resolving} onClick={() => settle("theirs")}>{resolving === "theirs" && <Spinner />}Keep theirs</Button>
          <Button size="sm" variant="outline" className="h-10 sm:h-8" disabled={!!resolving} onClick={() => settle("both")}>{resolving === "both" && <Spinner />}Keep both</Button>
        </div>
      </div>}
      {status === "error" && sync.error && !sync.conflict && <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-[13px] leading-5"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /><span className="min-w-0 flex-1">Not saved: {sync.error}. Your text is kept on this device.</span></div>}
      {page.inboxAt && !isTrashed && <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-bg-sunk px-3 py-2 text-[13px] text-fg-muted"><Inbox className="size-4 shrink-0" /><span className="min-w-0 flex-1">In your inbox — not filed yet.</span><Link href="/inbox" className="font-medium text-accent">Review inbox</Link></div>}
      {page.archived && !isTrashed && <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-bg-sunk px-3 py-2 text-[13px] text-fg-muted"><Archive className="size-4 shrink-0" /><span className="min-w-0 flex-1">Archived — hidden from the workspace tree, still searchable.</span></div>}
      <div className={cn("group/head", cover && icon ? "-mt-12 relative" : "mt-8")}>
        {(!icon || !cover) && <div className="mb-1 flex h-7 items-center gap-1 text-[12px] text-fg-faint opacity-0 transition-opacity focus-within:opacity-100 group-hover/head:opacity-100 max-md:opacity-100">
          {!icon && <Popover><PopoverTrigger asChild><button className="flex h-7 items-center gap-1 rounded-md px-2 hover:bg-bg-hover hover:text-fg-muted"><Smile className="size-3.5" /> Add icon</button></PopoverTrigger><PopoverContent className="w-64"><div className="grid grid-cols-8 gap-1">{EMOJI.map((e) => <button key={e} className="grid size-7 place-items-center rounded text-lg hover:bg-bg-sunk" onClick={() => { setIcon(e); queue({ icon: e }); }}>{e}</button>)}</div></PopoverContent></Popover>}
          {!cover && <CoverPicker onPick={(c) => { setCover(c); queue({ cover: c }); }} />}
        </div>}
        <div className="flex flex-col items-start gap-2">
          {icon && <Popover><PopoverTrigger asChild><button aria-label="Change icon" className={cn("grid size-16 place-items-center rounded-2xl text-[2.75rem] leading-none transition hover:bg-bg-hover", cover && "bg-bg shadow-card")}>{icon}</button></PopoverTrigger><PopoverContent className="w-64"><div className="grid grid-cols-8 gap-1">{EMOJI.map((e) => <button key={e} className="grid size-7 place-items-center rounded text-lg hover:bg-bg-sunk" onClick={() => { setIcon(e); queue({ icon: e }); }}>{e}</button>)}</div><button className="mt-2 text-[12px] text-fg-muted hover:text-fg" onClick={() => { setIcon(null); queue({ icon: null }); }}>Remove icon</button></PopoverContent></Popover>}
          <textarea value={title} onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }} placeholder="Untitled" rows={1} disabled={isTrashed} aria-label="Page title" style={{ outline: "none" }} data-page-title={page.id} className="page-title vt-page-title w-full resize-none overflow-hidden break-words bg-transparent [field-sizing:content] [overflow-wrap:anywhere] text-[clamp(1.625rem,6.4vw,1.875rem)] leading-[1.16] outline-none placeholder:text-fg-faint/70 md:text-display" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editorRef.current?.commands.focus("start"); } }} onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }} />
        </div>
      </div>
      {page.databaseId && <RowBanner databaseId={page.databaseId} />}
      {tags && tags.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5">{tags.map((t) => <button key={t} onClick={() => setTagOpen(true)} className="inline-flex h-7 items-center rounded-full border border-line bg-bg-elev px-2.5 text-[12px] text-fg-muted hover:border-accent/40">#{t}</button>)}</div>}
      <PageProperties page={page} onChange={(props) => queue({ properties: props })} />
      {page.type === "research" && <ResearchPanel pageId={page.id} />}
      {isDb ? (
        <div className="mt-4"><DatabaseView pageId={page.id} /></div>
      ) : (
        <div className="mt-3">
          <Editor content={page.content} pageId={page.id} editable={!isTrashed} autofocus={!title} onReady={(e) => { editorRef.current = e; /* a recovered draft or a remote copy may have arrived before the editor existed: show it now, without emitting an edit */ if (restored.current && !editorSynced.current) { setEditorDoc(e, restored.current); editorSynced.current = true; } }} onLock={(l) => { lockRef.current = l; }} onChange={(doc) => { if (lockRef.current) return; docRef.current = doc; queue({ content: doc }); }} />
        </div>
      )}
      {!isTrashed && <div className="mt-16 border-t border-line pt-5"><div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Connections</div><PageGraphCard pageId={page.id} /></div>}
      {backlinks.length > 0 && <div className="mt-6 border-t border-line pt-4"><div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-fg-muted"><Link2 className="size-3.5" /> {backlinks.length} backlink{backlinks.length > 1 ? "s" : ""}</div><div className="flex flex-wrap gap-1.5">{backlinks.map((b) => <Link key={b.id} href={`/p/${b.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-bg-elev px-3 text-[13px] shadow-card transition-colors hover:border-accent/40">{b.icon ?? "📄"} <span className="max-w-[14rem] truncate">{b.title}</span></Link>)}</div></div>}
      <Dialog open={compare && !!sync.conflict} onOpenChange={setCompare}>
        <SheetContent title="Compare the two versions" description="Read both, then choose. Whatever you pick, the other copy is kept in the version history." className="sm:w-[min(64rem,calc(100vw-2rem))]">
          {sync.conflict && <><div className="grid gap-3 md:grid-cols-2">
            <section aria-label="Your version" className="min-w-0 rounded-xl border border-accent/40 bg-bg p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">This device</div><div className="mb-2 break-words text-[15px] font-semibold">{sync.conflict.mine.title || "Untitled"}</div><div className="max-h-[38dvh] overflow-y-auto md:max-h-[55dvh]"><Editor key="mine" content={sync.conflict.mine.content} editable={false} /></div></section>
            <section aria-label="Other session's version" className="min-w-0 rounded-xl border border-line bg-bg p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Other session · {timeAgo(sync.conflict.server.updatedAt)}</div><div className="mb-2 break-words text-[15px] font-semibold">{sync.conflict.server.title || "Untitled"}</div><div className="max-h-[38dvh] overflow-y-auto md:max-h-[55dvh]"><Editor key={`srv-${sync.conflict.server.version}`} content={sync.conflict.server.content} editable={false} /></div></section>
          </div>
          <div className="sticky bottom-0 mt-3 grid grid-cols-3 gap-2 bg-bg-elev pt-2"><Button className="h-11" disabled={!!resolving} onClick={() => settle("mine")}>Keep mine</Button><Button variant="outline" className="h-11" disabled={!!resolving} onClick={() => settle("theirs")}>Keep theirs</Button><Button variant="outline" className="h-11" disabled={!!resolving} onClick={() => settle("both")}>Keep both</Button></div></>}
        </SheetContent>
      </Dialog>
      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <SheetContent title="Tags" description="Lower-case labels to find this page again. Tap a tag to remove it.">
          <div className="flex min-h-9 flex-wrap gap-1.5">{(tags ?? []).length ? tags!.map((t) => <button key={t} aria-label={`Remove tag ${t}`} onClick={() => saveTags(tags!.filter((x) => x !== t))} className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-bg px-3 text-[13px]">#{t}<X className="size-3.5 text-fg-faint" /></button>) : <span className="text-[13px] text-fg-faint">No tags yet.</span>}</div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = tagDraft.trim().replace(/^#/, "").toLowerCase(); if (t && !(tags ?? []).includes(t)) saveTags([...(tags ?? []), t]); setTagDraft(""); }}><input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} aria-label="New tag" placeholder="Add a tag…" maxLength={40} autoCapitalize="none" autoCorrect="off" enterKeyHint="done" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent/60" /><Button type="submit" className="h-11" disabled={!tagDraft.trim()}>Add</Button></form>
        </SheetContent>
      </Dialog>
      <Dialog open={versions !== null} onOpenChange={(o) => { if (!o) { setVersions(null); setPreview(null); } }}>
        <DialogContent title="Version history" description="Snapshots are kept every 20 saves, every 10 minutes of editing, and before each restore (max 200)." wide>
          <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
            <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">{versions?.length ? versions.map((v) => <button key={v.id} onClick={async () => setPreview(await api(`/api/pages/${page.id}/versions?v=${v.version}`))} className={cn("flex min-h-11 w-full flex-col justify-center rounded-md px-2 py-1.5 text-left hover:bg-bg-sunk", preview?.version === v.version && "bg-bg-sunk")}><span className="text-[13px] font-medium">{v.version > 0 ? `v${v.version}` : "Unapplied copy"} · {v.title}</span><span className="text-[11px] text-fg-faint"><Clock className="mr-1 inline size-3" />{timeAgo(v.createdAt)} · {v.reason} · {v.wordCount} words</span></button>) : <div className="p-3 text-[13px] text-fg-muted">No snapshots yet.</div>}</div>
            <div className="min-h-[200px] rounded-lg border border-line bg-bg p-3">{preview ? <><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">{preview.title}</span><Button size="sm" onClick={() => restore(preview.version)}><RotateCcw /> Restore</Button></div><div className="max-h-[50vh] overflow-y-auto"><Editor content={preview.content} editable={false} /></div></> : <div className="grid h-full place-items-center text-[13px] text-fg-muted">Select a version to preview</div>}</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const COVERS = ["aurora", "ink", "dusk", "moss", "paper", "grid"] as const;
function CoverPicker({ onPick, label = "Add cover" }: { onPick: (c: string) => void; label?: string }) {
  return (
    <Popover><PopoverTrigger asChild><button className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[12px]", label === "Add cover" ? "text-fg-faint hover:bg-bg-hover hover:text-fg-muted" : "bg-black/45 font-medium text-white backdrop-blur hover:bg-black/60")}><ImageIcon className="size-3.5" /> {label}</button></PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Gallery</div>
        <div className="grid grid-cols-3 gap-2">{COVERS.map((c) => <button key={c} aria-label={`Cover ${c}`} onClick={() => onPick(`preset:${c}`)} className={cn("h-12 rounded-lg ring-1 ring-line transition hover:ring-2 hover:ring-accent", `cover-${c}`)} />)}</div>
        <button className="mt-3 w-full rounded-md border border-line px-2 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={() => { const url = window.prompt("Cover image URL (https://…)"); if (url && /^https:\/\//.test(url)) onPick(url); }}>From an image URL…</button>
      </PopoverContent></Popover>
  );
}

function RowBanner({ databaseId }: { databaseId: string }) {
  const [db, setDb] = useState<any>(null);
  useEffect(() => { api(`/api/databases/${databaseId}`).then(setDb).catch(() => {}); }, [databaseId]);
  return <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-sunk px-3 py-2 text-[12px] text-fg-muted"><span>Row of database</span>{db ? <Link href={`/p/${db.pageId}`} className="font-medium text-fg hover:underline">{db.icon ?? "🗂"} {db.name}</Link> : <span className="pulse-soft">…</span>}<span className="ml-auto">Properties are edited in the database (side peek).</span></div>;
}
