"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, FileText, ListChecks, Link2, Image as ImageIcon, Paperclip, AudioLines, FolderInput, CheckSquare, Database, BookMarked, Archive, Trash2, Tag, MoreHorizontal, Plus, RefreshCw, ExternalLink, Files, FolderKanban, FlaskConical } from "lucide-react";
import { api } from "@/lib/client/api";
import { useUI } from "@/lib/client/store";
import { Dialog, SheetContent, Empty, Skeleton, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn, timeAgo } from "@/lib/utils";

interface Item { id: string; title: string; icon: string | null; kind: string | null; inboxAt: string; excerpt: string; wordCount: number; tags: string[]; url: string | null; image: string | null; openTasks: number }
const KIND: Record<string, React.ReactNode> = { note: <FileText />, tasks: <ListChecks />, link: <Link2 />, photo: <ImageIcon />, file: <Paperclip />, audio: <AudioLines /> };
type Act = { action: "keep"; section?: string } | { action: "task" } | { action: "database"; databaseId: string } | { action: "reference" } | { action: "archive" } | { action: "trash" };

/**
 * Daily review of what was captured. One tap files an item; "More" turns it into tasks, a database entry or a reference, tags it, archives it.
 * Every action answers with Undo (8 s on screen; the journal on the server keeps it reversible).
 */
export function InboxView() {
  const qc = useQueryClient(); const ui = useUI();
  const { data: items, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["inbox"], queryFn: () => api<Item[]>("/api/inbox") });
  const { data: dbs = [] } = useQuery({ queryKey: ["databases-list"], queryFn: () => api<any[]>("/api/databases"), staleTime: 60_000 });
  const [sheet, setSheet] = useState<Item | null>(null); const [mode, setMode] = useState<"menu" | "file" | "database" | "tags">("menu"); const [busy, setBusy] = useState<string | null>(null); const [tagDraft, setTagDraft] = useState("");
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["inbox"] }); qc.invalidateQueries({ queryKey: ["inbox-count"] }); qc.invalidateQueries({ queryKey: ["tree"] }); };
  async function act(it: Item, a: Act) {
    setBusy(it.id); setSheet(null);
    qc.setQueryData<Item[]>(["inbox"], (old) => old?.filter((x) => x.id !== it.id)); // optimistic: the row leaves at once
    try {
      const r = await api<{ actionId: string; summary: string }>(`/api/inbox/${it.id}`, { method: "POST", json: a });
      invalidate();
      toast(r.summary, { description: it.title, tone: "success", action: { label: "Undo", run: async () => { try { await api("/api/inbox/undo", { method: "POST", json: { actionId: r.actionId } }); invalidate(); toast("Back in the inbox"); } catch (e: any) { toast("Could not undo", { description: e.message, tone: "danger" }); } } } });
    } catch (e: any) { invalidate(); toast("Nothing was changed", { description: e.message, tone: "danger" }); }
    finally { setBusy(null); }
  }
  async function saveTags(it: Item, tags: string[]) { try { const saved = await api<string[]>(`/api/pages/${it.id}/tags`, { method: "PUT", json: { tags } }); qc.setQueryData<Item[]>(["inbox"], (old) => old?.map((x) => (x.id === it.id ? { ...x, tags: saved } : x))); setSheet((s) => (s && s.id === it.id ? { ...s, tags: saved } : s)); } catch (e: any) { toast("Could not save tags", { description: e.message, tone: "danger" }); } }
  const open = (it: Item, m: typeof mode = "menu") => { setMode(m); setTagDraft(""); setSheet(it); };
  const R = ({ icon, label, hint, onTap, danger }: { icon: React.ReactNode; label: string; hint?: string; onTap: () => void; danger?: boolean }) => <button type="button" onClick={onTap} className={cn("flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left active:bg-bg-sunk [&_svg]:size-5 [&_svg]:shrink-0", danger ? "text-danger" : "[&_svg]:text-fg-muted")}>{icon}<span className="min-w-0 flex-1"><span className="block text-[15px]">{label}</span>{hint && <span className="block truncate text-[12.5px] text-fg-faint">{hint}</span>}</span></button>;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <div className="min-w-0 flex-1"><h1 className="text-[22px] font-semibold tracking-tight">Inbox</h1><p className="text-[13px] text-fg-muted">{items ? (items.length ? `${items.length} to sort` : "All sorted") : " "}</p></div>
        <Button variant="ghost" size="icon" aria-label="Refresh" className="size-11" onClick={() => refetch()}>{isFetching ? <Spinner /> : <RefreshCw />}</Button>
        <Button className="h-11 max-md:hidden" onClick={() => ui.set({ captureOpen: true })}><Plus /> Capture</Button>
      </div>
      {isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : error ? <Empty icon={<Inbox />} title="The inbox could not be loaded" hint={(error as Error).message} action={<Button onClick={() => refetch()}>Try again</Button>} />
        : !items!.length ? <Empty icon={<Inbox />} title="Nothing to sort" hint="Capture a thought, a link, a photo or a to-do with the + button. It waits here until you file it." action={<Button className="h-11" onClick={() => ui.set({ captureOpen: true })}><Plus /> Capture something</Button>} />
        : <ul className="space-y-2.5">{items!.map((it) => (
          <li key={it.id} className={cn("overflow-hidden rounded-2xl border border-line bg-bg-elev shadow-card", busy === it.id && "opacity-50")}>
            <Link href={`/p/${it.id}`} className="flex gap-3 p-3.5 active:bg-bg-sunk">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-bg-sunk text-fg-muted [&_svg]:size-4">{KIND[it.kind ?? "note"] ?? <FileText />}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15.5px] font-medium leading-snug [overflow-wrap:anywhere]">{it.title || "Untitled"}</span>
                {it.excerpt && it.excerpt !== it.title && <span className="mt-0.5 line-clamp-2 block break-words text-[13.5px] leading-5 text-fg-muted [overflow-wrap:anywhere]">{it.excerpt}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-faint"><span>{timeAgo(it.inboxAt)}</span>{it.openTasks > 0 && <span>{it.openTasks} to do</span>}{it.url && <span className="inline-flex max-w-[12rem] items-center gap-1 truncate"><ExternalLink className="size-3" />{(() => { try { return new URL(it.url).hostname.replace(/^www\./, ""); } catch { return "link"; } })()}</span>}{it.tags.map((t) => <span key={t}>#{t}</span>)}</span>
              </span>
              {it.image && <img src={it.image} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" />}
            </Link>
            <div className="flex border-t border-line">
              <button type="button" onClick={() => open(it, "file")} className="flex h-11 flex-1 items-center justify-center gap-1.5 text-[13.5px] font-medium text-accent active:bg-bg-sunk"><FolderInput className="size-4" />File</button>
              <span aria-hidden className="w-px bg-line" />
              <button type="button" onClick={() => act(it, { action: "archive" })} className="flex h-11 flex-1 items-center justify-center gap-1.5 text-[13.5px] font-medium text-fg-muted active:bg-bg-sunk"><Archive className="size-4" />Archive</button>
              <span aria-hidden className="w-px bg-line" />
              <button type="button" aria-label={`More actions for ${it.title}`} onClick={() => open(it)} className="flex h-11 flex-1 items-center justify-center gap-1.5 text-[13.5px] font-medium text-fg-muted active:bg-bg-sunk"><MoreHorizontal className="size-4" />More</button>
            </div>
          </li>))}</ul>}
      <Dialog open={sheet !== null} onOpenChange={(o) => { if (!o) setSheet(null); }}>
        {sheet && <SheetContent title={mode === "file" ? "File in…" : mode === "database" ? "Add to a database" : mode === "tags" ? "Tags" : sheet.title || "Untitled"} description={mode === "menu" ? "Every action can be undone." : mode === "file" ? "The note leaves the inbox and appears in that space." : mode === "database" ? "A new entry is created with this title and content; the capture is archived." : undefined}>
          {mode === "menu" && <div className="-mx-1 space-y-0.5">
            <R icon={<FolderInput />} label="File in a space" hint="Notes, Documents, Projects, Research" onTap={() => setMode("file")} />
            <R icon={<CheckSquare />} label={sheet.openTasks > 1 ? `Create ${sheet.openTasks} tasks` : "Turn into a task"} hint="Linked to this note" onTap={() => act(sheet, { action: "task" })} />
            <R icon={<Database />} label="Add to a database" hint={dbs.length ? `${dbs.length} available` : "No database yet"} onTap={() => setMode("database")} />
            <R icon={<BookMarked />} label="Save as a reference" hint={sheet.url ? "Uses the link; a DOI is looked up on Crossref" : "A DOI in the text is looked up on Crossref"} onTap={() => act(sheet, { action: "reference" })} />
            <R icon={<Tag />} label="Tags" hint={sheet.tags.length ? sheet.tags.map((t) => `#${t}`).join(" ") : "None"} onTap={() => setMode("tags")} />
            <R icon={<Archive />} label="Archive" hint="Out of the way, still searchable" onTap={() => act(sheet, { action: "archive" })} />
            <R icon={<Trash2 />} label="Move to trash" danger onTap={() => act(sheet, { action: "trash" })} />
          </div>}
          {mode === "file" && <div className="-mx-1 space-y-0.5">{[["notes", "Notes", <FileText key="n" />], ["documents", "Documents", <Files key="d" />], ["projects", "Projects", <FolderKanban key="p" />], ["research", "Research", <FlaskConical key="r" />]].map(([id, label, ic]) => <R key={id as string} icon={ic as React.ReactNode} label={label as string} onTap={() => act(sheet, { action: "keep", section: id as string })} />)}</div>}
          {mode === "database" && (dbs.length ? <div className="-mx-1 space-y-0.5">{dbs.map((d: any) => <R key={d.id} icon={<span className="text-[18px] leading-none">{d.icon ?? "🗂"}</span>} label={d.name} onTap={() => act(sheet, { action: "database", databaseId: d.id })} />)}</div> : <p className="py-6 text-center text-[14px] text-fg-muted">Create a database first (More → New database).</p>)}
          {mode === "tags" && <>
            <div className="flex min-h-9 flex-wrap gap-1.5">{sheet.tags.length ? sheet.tags.map((t) => <button key={t} aria-label={`Remove tag ${t}`} onClick={() => saveTags(sheet, sheet.tags.filter((x) => x !== t))} className="inline-flex h-9 items-center rounded-full border border-line bg-bg px-3 text-[13px]">#{t} ×</button>) : <span className="text-[13px] text-fg-faint">No tags yet.</span>}</div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = tagDraft.trim().replace(/^#/, "").toLowerCase(); if (t && !sheet.tags.includes(t)) saveTags(sheet, [...sheet.tags, t]); setTagDraft(""); }}><input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} aria-label="New tag" placeholder="Add a tag…" maxLength={40} autoCapitalize="none" autoCorrect="off" enterKeyHint="done" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent/60" /><Button type="submit" className="h-11" disabled={!tagDraft.trim()}>Add</Button></form>
          </>}
          {mode !== "menu" && <button type="button" onClick={() => setMode("menu")} className="mt-2 h-11 w-full text-[14px] font-medium text-fg-muted">Back</button>}
        </SheetContent>}
      </Dialog>
    </div>
  );
}
