"use client";
/**
 * file: src/components/offline/OfflineApp.tsx
 * description: the app when the server cannot be reached. The service worker answers any navigation it cannot fetch with the static
 *   shell at /offline; this component then works from the device replica only (IndexedDB): the list of notes, any synced note opened in
 *   the real editor, new notes, tags, pin, trash, tasks, quick capture. Every change goes to the mutation journal / the page draft and
 *   is sent when the server is back; the app then returns to the full (server-rendered) app at the same address. Addresses are the
 *   real ones (/, /p/<id>, /tasks, /inbox), so a bookmark or a reload works the same offline.
 *   Not available offline (said on screen): search index, AI, databases, graph, research, settings.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TEditor } from "@tiptap/react";
import { CloudOff, FileText, Home, Inbox, ListTodo, Pin, Plus, Search, Tag, Trash2, Zap, ArrowLeft, X } from "lucide-react";
import { Editor, getEditorDoc, setEditorDoc } from "@/components/editor/Editor";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePageSync, type ServerCopy } from "@/lib/client/page-sync";
import { createPage, createTask, setPageTags, startSyncEngine, syncNow, trashPage, updatePageMeta, updateTask } from "@/lib/client/journal";
import { getReplicaPage, listReplicaPages, listReplicaTasks, syncInfo, type RPage, type RTask, type SyncInfo } from "@/lib/client/replica";
import { listDrafts } from "@/lib/client/offline";
import { enqueueCapture, flushOutbox } from "@/lib/client/outbox";
import { SyncStatus } from "./SyncStatus";
import { cn, timeAgo } from "@/lib/utils";

const SECTIONS: [string, string][] = [["notes", "Notes"], ["documents", "Documents"], ["projects", "Projects"], ["research", "Research"], ["databases", "Databases"]];
const textOf = (n: any): string => (!n ? "" : typeof n.text === "string" ? n.text : Array.isArray(n.content) ? n.content.map(textOf).join(" ") : "");
type Row = RPage & { draftTitle?: string };

/** True while the server answers. navigator.onLine alone is not enough (server down, captive portal): a light probe confirms. */
function useReachable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    const probe = async () => { if (!navigator.onLine) { if (alive) setOk(false); return; } try { const r = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" }); if (alive) setOk(r.ok); } catch { if (alive) setOk(false); } };
    probe(); const t = setInterval(probe, 15_000); const off = () => setOk(false);
    window.addEventListener("online", probe); window.addEventListener("offline", off);
    return () => { alive = false; clearInterval(t); window.removeEventListener("online", probe); window.removeEventListener("offline", off); };
  }, []);
  return ok;
}

export function OfflineApp() {
  const [path, setPath] = useState<string | null>(null); const [pages, setPages] = useState<Row[] | null>(null); const [tasks, setTasks] = useState<RTask[]>([]); const [info, setInfo] = useState<SyncInfo | null>(null);
  const [q, setQ] = useState(""); const [returning, setReturning] = useState(false); const reachable = useReachable(); const dirty = useRef<() => boolean>(() => false);
  const load = useCallback(async () => {
    const [ps, ts, drafts, i] = await Promise.all([listReplicaPages(), listReplicaTasks(), listDrafts(), syncInfo().catch(() => null)]);
    const dt = new Map(drafts.filter((d) => typeof d.patch.title === "string").map((d) => [d.pageId, String(d.patch.title)]));
    setPages(ps.map((p) => (dt.has(p.id) ? { ...p, draftTitle: dt.get(p.id) } : p))); setTasks(ts); setInfo(i);
  }, []);
  useEffect(() => {
    const here = () => setPath(window.location.pathname === "/offline" ? "/" : window.location.pathname);
    here(); load(); window.addEventListener("popstate", here);
    const evs = ["note:replica-changed", "note:journal-changed", "note:local-changed"]; for (const n of evs) window.addEventListener(n, load);
    return () => { window.removeEventListener("popstate", here); for (const n of evs) window.removeEventListener(n, load); };
  }, [load]);
  const go = useCallback((to: string) => { window.history.pushState(null, "", to); setPath(to); document.getElementById("offline-main")?.scrollTo(0, 0); }, []);
  // The server is back: send everything that waited, then hand over to the full app at the same address.
  useEffect(() => {
    if (!reachable) return; let cancelled = false; setReturning(true);
    (async () => {
      const stop = startSyncEngine(); await flushOutbox().catch(() => {}); await syncNow().catch(() => {});
      for (let i = 0; i < 40 && !cancelled && dirty.current(); i++) await new Promise((r) => setTimeout(r, 250)); // the open note finishes its own save
      await syncNow().catch(() => {}); stop();
      if (!cancelled) window.location.replace(window.location.pathname === "/offline" ? "/" : window.location.pathname + window.location.search);
    })();
    return () => { cancelled = true; setReturning(false); };
  }, [reachable]);

  const live = useMemo(() => (pages ?? []).filter((p) => !p.deletedAt && !p.archived && !p.databaseId), [pages]);
  const found = useMemo(() => { const s = q.trim().toLowerCase(); if (!s) return null; return live.filter((p) => (p.draftTitle ?? p.title).toLowerCase().includes(s) || textOf(p.content).toLowerCase().includes(s)).slice(0, 60); }, [q, live]);
  async function newNote() { try { const r = await createPage({ title: "", section: "notes" }); await load(); go(`/p/${r.id}`); } catch (e: any) { toast("Could not create the note", { description: e.message, tone: "danger" }); } }

  if (path === null || pages === null) return <main className="grid min-h-dvh place-items-center bg-bg text-fg-muted"><span className="pulse-soft text-[14px]">Opening the copy kept on this device…</span></main>;
  if (!pages.length && !info?.lastSync) return <NothingHere returning={returning} />;
  const pageId = path.startsWith("/p/") ? path.slice(3) : null; const nav = "flex h-9 items-center gap-2 rounded-control px-2.5 text-[13.5px] text-fg-muted hover:bg-bg-hover hover:text-fg";
  const known = pageId || path === "/" || path === "/tasks" || path === "/inbox" || path === "/share";
  return (
    <div data-testid="offline-app" className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <aside className="hidden w-[17rem] shrink-0 flex-col border-r border-line bg-bg-side md:flex">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 text-[13px] font-semibold"><CloudOff className="size-4 text-warning" /> Note · offline copy</div>
        <nav aria-label="Offline navigation" className="space-y-0.5 p-2">
          <button className={cn(nav, "w-full", path === "/" && "bg-bg-hover text-fg")} onClick={() => go("/")}><Home className="size-4" /> Home</button>
          <button className={cn(nav, "w-full", path === "/inbox" && "bg-bg-hover text-fg")} onClick={() => go("/inbox")}><Inbox className="size-4" /> Inbox</button>
          <button className={cn(nav, "w-full", path === "/tasks" && "bg-bg-hover text-fg")} onClick={() => go("/tasks")}><ListTodo className="size-4" /> Tasks</button>
          <button className={cn(nav, "w-full text-accent")} onClick={newNote}><Plus className="size-4" /> New note</button>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {SECTIONS.map(([key, label]) => { const list = live.filter((p) => p.section === key && !p.inboxAt); if (!list.length) return null; return (
            <div key={key} className="mt-2"><div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">{label}</div>
              {list.slice(0, 200).map((p) => <button key={p.id} onClick={() => go(`/p/${p.id}`)} className={cn(nav, "w-full min-w-0", pageId === p.id && "bg-bg-hover text-fg")}><span className="shrink-0">{p.icon ?? (p.type === "database" ? "🗂" : "📄")}</span><span className="truncate">{p.draftTitle ?? p.title ?? "Untitled"}</span></button>)}</div>); })}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2.5 safe-top">
          {path !== "/" && <button aria-label="Back to the list" className="icon-btn md:hidden" onClick={() => go("/")}><ArrowLeft className="size-4" /></button>}
          <span role="status" data-testid="offline-banner" className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] text-fg-muted">
            <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium", returning ? "bg-accent-soft text-accent" : "bg-warning/20 text-fg")}>{returning ? "Back online · syncing…" : "Offline"}</span>
            <span className="truncate max-sm:hidden">{returning ? "Sending what was waiting, then opening the full app." : `Working from the copy on this device${info?.lastSync ? ` · synced ${timeAgo(info.lastSync)}` : ""}. Changes are kept and sent later.`}</span>
          </span>
          <button aria-label="New note" className="icon-btn md:hidden" onClick={newNote}><Plus className="size-4" /></button>
          <SyncStatus />
        </header>
        <main id="offline-main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6">
          {pageId ? <OfflinePage key={pageId} id={pageId} go={go} dirty={dirty} tasks={tasks} />
            : path === "/tasks" ? <OfflineTasks tasks={tasks} pages={live} go={go} />
              : path === "/inbox" ? <List title="Inbox" hint="Captures waiting to be filed." rows={live.filter((p) => p.inboxAt)} go={go} empty="No capture on this device." capture />
                : <div className="mx-auto w-full max-w-3xl px-4 py-5">
                  {!known && <div role="note" className="mb-4 rounded-lg border border-line bg-bg-sunk px-3 py-2 text-[13px] text-fg-muted">This screen needs a connection (search index, AI, databases, graph, research and settings are not kept on the device). Your notes and tasks are below.</div>}
                  {path === "/share" && <Capture initial={new URLSearchParams(window.location.search)} />}
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-bg-elev px-3"><Search className="size-4 text-fg-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes on this device" placeholder="Search the notes on this device…" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none" />{q && <button aria-label="Clear" onClick={() => setQ("")}><X className="size-4 text-fg-muted" /></button>}</label>
                  {found ? <Rows rows={found} go={go} empty="No note on this device matches." /> : <>
                    {live.some((p) => p.pinned) && <><h2 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Pinned</h2><Rows rows={live.filter((p) => p.pinned)} go={go} /></>}
                    <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Recent · {live.length} notes on this device</h2>
                    <Rows rows={[...live].filter((p) => !p.inboxAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 60)} go={go} empty="No note yet. Create one: it is sent when the connection returns." />
                  </>}
                </div>}
        </main>
        <nav aria-label="Offline navigation" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-bg-elev pb-[env(safe-area-inset-bottom)] md:hidden">
          {([["/", "Home", Home], ["/inbox", "Inbox", Inbox], ["/tasks", "Tasks", ListTodo]] as const).map(([to, label, Icon]) => <button key={to} onClick={() => go(to)} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]", path === to ? "text-accent" : "text-fg-muted")}><Icon className="size-5" />{label}</button>)}
          <button onClick={newNote} className="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-accent"><Plus className="size-5" />New</button>
        </nav>
      </div>
    </div>
  );
}

function NothingHere({ returning }: { returning: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center safe-top safe-bottom">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-bg-sunk text-fg-muted"><CloudOff className="size-7" /></div>
        <h1 className="text-[19px] font-semibold">{returning ? "Back online…" : "You are offline"}</h1>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">No copy of your notes is kept on this device yet (it is made the first time the app is opened with a connection, and erased by “Lock this device”). Text you were typing and captures made offline are kept here and are sent as soon as the network returns.</p>
        <button onClick={() => window.location.reload()} className="mt-5 h-11 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg">Try again</button>
      </div>
    </main>
  );
}
function Rows({ rows, go, empty }: { rows: Row[]; go: (to: string) => void; empty?: string }) {
  if (!rows.length) return empty ? <p className="mt-3 text-[13.5px] text-fg-muted">{empty}</p> : null;
  return <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev">{rows.map((p) => <li key={p.id}><button data-testid="offline-row" onClick={() => go(`/p/${p.id}`)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover"><span className="shrink-0 text-[16px]">{p.icon ?? (p.type === "database" ? "🗂" : "📄")}</span><span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-medium">{p.draftTitle ?? p.title ?? "Untitled"}</span><span className="block truncate text-[12px] text-fg-muted">{p.local ? "Created on this device · waiting to sync" : `Edited ${timeAgo(p.updatedAt)}`}{p.tags?.length ? ` · ${p.tags.map((t) => `#${t}`).join(" ")}` : ""}</span></span>{p.pinned && <Pin className="size-3.5 shrink-0 text-fg-muted" />}</button></li>)}</ul>;
}
function List({ title, hint, rows, go, empty, capture }: { title: string; hint: string; rows: Row[]; go: (to: string) => void; empty: string; capture?: boolean }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-5"><h1 className="text-[22px] font-semibold">{title}</h1><p className="mt-1 text-[13.5px] text-fg-muted">{hint}</p>{capture && <Capture />}<Rows rows={rows} go={go} empty={empty} /></div>;
}
/** Quick capture: goes to the capture outbox (idempotent), sent when the network returns. */
function Capture({ initial }: { initial?: URLSearchParams }) {
  const [text, setText] = useState(() => (initial ? [initial.get("title"), initial.get("text"), initial.get("url")].filter(Boolean).join("\n") : "")); const [busy, setBusy] = useState(false);
  async function save() { const t = text.trim(); if (!t || busy) return; setBusy(true); try { const r = await enqueueCapture({ kind: /^(https?:\/\/|www\.)\S+$/i.test(t) ? "link" : "note", text: t }); setText(""); toast(r.sent ? "Captured to inbox" : "Kept on this device", { description: r.sent ? undefined : "The capture is sent when the connection returns.", tone: "success" }); } finally { setBusy(false); } }
  return <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}><input value={text} onChange={(e) => setText(e.target.value)} aria-label="Quick capture" placeholder="Capture a thought or a link…" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg-elev px-3 text-[16px] outline-none focus:border-accent/60" /><Button type="submit" className="h-11" disabled={!text.trim() || busy}><Zap /> Capture</Button></form>;
}

function OfflineTasks({ tasks, pages, go }: { tasks: RTask[]; pages: Row[]; go: (to: string) => void }) {
  const [title, setTitle] = useState(""); const [showDone, setShowDone] = useState(false);
  const open = tasks.filter((t) => !t.deletedAt && t.status !== "done").sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || a.createdAt.localeCompare(b.createdAt));
  const done = tasks.filter((t) => !t.deletedAt && t.status === "done").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 50);
  const titleOf = (id: string | null) => (id ? pages.find((p) => p.id === id) : null);
  async function add() { const t = title.trim(); if (!t) return; setTitle(""); try { await createTask({ title: t }); } catch (e: any) { toast("Could not add the task", { description: e.message, tone: "danger" }); } }
  const item = (t: RTask) => { const pg = titleOf(t.pageId); return (
    <li key={t.id} data-testid="offline-task" data-status={t.status} className="flex min-h-12 items-center gap-3 px-3 py-2">
      <input type="checkbox" aria-label={`${t.status === "done" ? "Reopen" : "Complete"} ${t.title}`} checked={t.status === "done"} onChange={() => updateTask(t.id, { status: t.status === "done" ? "todo" : "done" }).catch((e) => toast("Could not update the task", { description: e.message, tone: "danger" }))} className="size-5 shrink-0 accent-[var(--color-accent)]" />
      <span className="min-w-0 flex-1"><span className={cn("block break-words text-[14.5px]", t.status === "done" && "text-fg-muted line-through")}>{t.title}</span><span className="block truncate text-[12px] text-fg-muted">{t.local ? "Waiting to sync" : t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString("en-CA")}` : "No date"}{t.priority === "high" ? " · high" : ""}{pg ? " · " : ""}{pg && <button className="text-accent hover:underline" onClick={() => go(`/p/${pg.id}`)}>{pg.draftTitle ?? pg.title}</button>}</span></span>
    </li>); };
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <h1 className="text-[22px] font-semibold">Tasks</h1><p className="mt-1 text-[13.5px] text-fg-muted">{open.length} open on this device. Changes are sent when the connection returns.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New task" placeholder="Add a task…" maxLength={500} className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg-elev px-3 text-[16px] outline-none focus:border-accent/60" /><Button type="submit" className="h-11" disabled={!title.trim()}><Plus /> Add</Button></form>
      {open.length ? <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev">{open.map(item)}</ul> : <p className="mt-3 text-[13.5px] text-fg-muted">No open task on this device.</p>}
      {done.length > 0 && <button className="mt-4 text-[13px] font-medium text-accent" onClick={() => setShowDone((s) => !s)}>{showDone ? "Hide" : "Show"} {done.length} done</button>}
      {showDone && <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev">{done.map(item)}</ul>}
    </div>
  );
}

function OfflinePage({ id, go, dirty, tasks }: { id: string; go: (to: string) => void; dirty: React.MutableRefObject<() => boolean>; tasks: RTask[] }) {
  const [page, setPage] = useState<RPage | null | undefined>(undefined);
  useEffect(() => { let alive = true; getReplicaPage(id).then((p) => { if (alive) setPage(p ?? null); }); return () => { alive = false; }; }, [id]);
  if (page === undefined) return <div className="p-6 text-[14px] text-fg-muted">Opening…</div>;
  if (page === null) return <div className="mx-auto max-w-xl px-4 py-10 text-center"><FileText className="mx-auto size-8 text-fg-muted" /><h1 className="mt-3 text-[18px] font-semibold">This note is not on this device</h1><p className="mt-2 text-[14px] leading-6 text-fg-muted">It was created or shared after the last sync, or it does not exist. It will open when the connection returns.</p><Button className="mt-4" onClick={() => go("/")}>Back to the notes on this device</Button></div>;
  return <OfflineEditor page={page} go={go} dirty={dirty} tasks={tasks} />;
}
function OfflineEditor({ page, go, dirty, tasks }: { page: RPage; go: (to: string) => void; dirty: React.MutableRefObject<() => boolean>; tasks: RTask[] }) {
  const [title, setTitle] = useState(page.title === "Untitled" ? "" : page.title); const [pinned, setPinned] = useState(page.pinned); const [tags, setTags] = useState<string[]>(page.tags ?? []); const [tagDraft, setTagDraft] = useState(""); const [tagOpen, setTagOpen] = useState(false); const [task, setTask] = useState("");
  const editorRef = useRef<TEditor | null>(null); const titleRef = useRef(title); titleRef.current = title; const docRef = useRef<any>(page.content); const restored = useRef<any>(null); const synced = useRef(false);
  const sync = usePageSync({ id: page.id, version: page.version, title: page.title, content: page.content, updatedAt: page.updatedAt }, {
    current: () => ({ title: titleRef.current, content: editorRef.current ? getEditorDoc(editorRef.current) : docRef.current }),
    applyRemote: (c: ServerCopy) => { setTitle(c.title === "Untitled" ? "" : c.title); docRef.current = c.content; restored.current = c.content; const ed = editorRef.current; if (ed) { setEditorDoc(ed, c.content); synced.current = true; } },
  });
  useEffect(() => { dirty.current = () => sync.hasPending() && sync.status !== "conflict" && sync.status !== "error"; return () => { dirty.current = () => false; }; });
  const readOnly = Boolean(page.deletedAt) || page.type === "database" || page.type === "canvas"; const mine = tasks.filter((t) => t.pageId === page.id && !t.deletedAt);
  const fail = (what: string) => (e: any) => toast(what, { description: e.message, tone: "danger" });
  async function saveTags(next: string[]) { setTags(next); await setPageTags(page.id, next).catch(fail("Could not save tags")); }
  const state = sync.status === "conflict" ? "Changed elsewhere" : sync.status === "error" ? "Not saved" : sync.status === "saved" && !sync.hasPending() ? (page.local ? "On this device · waiting to sync" : "Up to date on this device") : "Kept on this device · will sync";
  return (
    <article data-testid="offline-page" data-page-id={page.id} className="mx-auto w-full max-w-[46rem] px-4 py-5 md:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
        <span data-testid="offline-page-status" data-status={sync.status} className="mr-auto inline-flex h-7 items-center rounded-full bg-bg-sunk px-2.5">{state}</span>
        {!readOnly && <><button aria-pressed={pinned} className={cn("inline-flex h-8 items-center gap-1 rounded-control px-2 hover:bg-bg-hover", pinned && "text-accent")} onClick={() => { const n = !pinned; setPinned(n); updatePageMeta(page.id, { pinned: n }).catch(fail("Could not pin")); }}><Pin className="size-4" /> {pinned ? "Pinned" : "Pin"}</button>
          <button className="inline-flex h-8 items-center gap-1 rounded-control px-2 hover:bg-bg-hover" onClick={() => setTagOpen((o) => !o)}><Tag className="size-4" /> Tags</button>
          <button className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-danger-text hover:bg-bg-hover" onClick={() => { if (window.confirm("Move this note to the trash?")) trashPage(page.id).then(() => { toast("Moved to trash", { description: "Sent when the connection returns." }); go("/"); }).catch(fail("Could not move to trash")); }}><Trash2 className="size-4" /> Trash</button></>}
      </div>
      {sync.status === "conflict" && <div role="alert" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">This note was changed in another session while you edited it here. Nothing was overwritten: your text is kept on this device. <button className="font-medium text-accent underline" onClick={() => window.location.reload()}>Open the full app to compare both versions</button>.</div>}
      {sync.status === "error" && <div role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]">The server refused this save ({sync.error}). Your text is kept on this device. <button className="font-medium text-accent underline" onClick={() => sync.retry()}>Try again</button></div>}
      {page.deletedAt && <div role="note" className="mb-3 rounded-lg border border-line bg-bg-sunk px-3 py-2 text-[13px] text-fg-muted">This note is in the trash (read-only).</div>}
      <textarea value={title} onChange={(e) => { setTitle(e.target.value); sync.queue({ title: e.target.value }); }} placeholder="Untitled" rows={1} disabled={readOnly} aria-label="Page title" style={{ outline: "none" }} className="page-title w-full resize-none overflow-hidden break-words bg-transparent [field-sizing:content] [overflow-wrap:anywhere] text-[clamp(1.625rem,6.4vw,1.875rem)] leading-[1.16] outline-none placeholder:text-fg-faint/70 md:text-display" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editorRef.current?.commands.focus("start"); } }} />
      {(tags.length > 0 || tagOpen) && <div className="mt-2 flex flex-wrap items-center gap-1.5">{tags.map((t) => <button key={t} aria-label={`Remove tag ${t}`} disabled={readOnly} onClick={() => saveTags(tags.filter((x) => x !== t))} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-bg-elev px-2.5 text-[12px] text-fg-muted">#{t}{!readOnly && <X className="size-3" />}</button>)}
        {tagOpen && !readOnly && <form onSubmit={(e) => { e.preventDefault(); const t = tagDraft.trim().replace(/^#/, "").toLowerCase(); if (t && !tags.includes(t)) saveTags([...tags, t]); setTagDraft(""); }}><input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} aria-label="New tag" placeholder="Add a tag…" maxLength={40} autoCapitalize="none" className="h-7 w-32 rounded-full border border-line bg-bg px-2.5 text-[12px] outline-none focus:border-accent/60" /></form>}</div>}
      {page.type === "database" || page.type === "canvas" ? <div role="note" className="mt-4 rounded-lg border border-line bg-bg-sunk px-3 py-3 text-[13.5px] text-fg-muted">{page.type === "database" ? "Databases" : "Canvases"} are not kept on this device: this one opens when the connection returns.</div>
        : <div className="mt-3"><Editor content={page.content} pageId={page.id} editable={!readOnly} autofocus={!title && !readOnly} onReady={(e) => { editorRef.current = e; if (restored.current && !synced.current) { setEditorDoc(e, restored.current); synced.current = true; } }} onChange={(doc) => { docRef.current = doc; sync.queue({ content: doc }); }} /></div>}
      {!readOnly && <section aria-label="Tasks of this note" className="mt-8 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Tasks of this note</h2>
        {mine.length > 0 && <ul className="mt-2 space-y-1">{mine.map((t) => <li key={t.id} data-testid="offline-page-task" className="flex items-center gap-2 text-[14px]"><input type="checkbox" aria-label={`${t.status === "done" ? "Reopen" : "Complete"} ${t.title}`} checked={t.status === "done"} onChange={() => updateTask(t.id, { status: t.status === "done" ? "todo" : "done" }).catch(fail("Could not update the task"))} className="size-4 accent-[var(--color-accent)]" /><span className={cn(t.status === "done" && "text-fg-muted line-through")}>{t.title}</span></li>)}</ul>}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = task.trim(); if (!t) return; setTask(""); createTask({ title: t, pageId: page.id }).catch(fail("Could not add the task")); }}><input value={task} onChange={(e) => setTask(e.target.value)} aria-label="New task for this note" placeholder="Add a task for this note…" maxLength={500} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-bg-elev px-3 text-[15px] outline-none focus:border-accent/60" /><Button type="submit" variant="outline" className="h-10" disabled={!task.trim()}><Plus /> Add task</Button></form>
      </section>}
    </article>
  );
}
