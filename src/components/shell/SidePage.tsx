"use client";
/**
 * file: src/components/shell/SidePage.tsx
 * description: "open to the side" — a second page, fully editable, in the right panel next to the main one. It runs its own sync
 *   engine (usePageSync): saves, offline drafts and conflict detection behave exactly as on the page itself; a conflict is resolved
 *   on the page (the pane turns read-only and says so).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Check, CloudOff, TriangleAlert } from "lucide-react";
import type { Editor as TEditor } from "@tiptap/react";
import { usePageSync, type ServerCopy } from "@/lib/client/page-sync";
import { api } from "@/lib/client/api";
import type { PMNode } from "@/lib/editor/text";
import { Editor, getEditorDoc, setEditorDoc, type EditorLock } from "@/components/editor/Editor";

/** A second page, editable, beside the main one. Its own sync engine: saves, conflicts and offline drafts behave as on the page itself. */
export function SidePage({ pageId, mainPageId }: { pageId: string; mainPageId: string | null }) {
  const q = useQuery({ queryKey: ["side-page", pageId], staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, retry: false, queryFn: () => api<{ id: string; version: number; title: string; icon: string | null; content: PMNode; updatedAt: string; type: string; deletedAt: string | null }>(`/api/pages/${pageId}`) });
  if (pageId === mainPageId) return <div className="p-4 text-ui text-fg-muted">This page is already open in the main view.</div>;
  if (q.isLoading) return <div className="p-4"><div className="skeleton mb-3 h-7 w-2/3" /><div className="skeleton mb-2 h-4 w-full" /><div className="skeleton h-4 w-4/5" /></div>;
  if (!q.data) return <div className="p-4 text-ui text-fg-muted">This page could not be loaded.</div>;
  if (q.data.type === "database") return <div className="p-4 text-ui text-fg-muted">Databases open in the main view. <Link className="text-accent underline" href={`/p/${pageId}`}>Open it</Link></div>;
  return <SidePageEditor key={pageId} page={q.data} />;
}
function SidePageEditor({ page }: { page: { id: string; version: number; title: string; icon: string | null; content: PMNode; updatedAt: string; deletedAt: string | null } }) {
  const editorRef = React.useRef<TEditor | null>(null); const lock = React.useRef<EditorLock | null>(null); const doc = React.useRef<PMNode>(page.content); const [title, setTitle] = React.useState(page.title === "Untitled" ? "" : page.title); const titleRef = React.useRef(title); titleRef.current = title;
  const sync = usePageSync(page, {
    current: () => ({ title: titleRef.current, content: !lock.current && editorRef.current ? getEditorDoc(editorRef.current) : doc.current }),
    applyRemote: (c: ServerCopy) => { setTitle(c.title === "Untitled" ? "" : c.title); doc.current = c.content; if (editorRef.current) setEditorDoc(editorRef.current, c.content); },
  });
  const s = sync.status;
  return (
    <div className="px-5 pb-24 pt-3" data-testid="side-page">
      <div className="flex items-center gap-2 text-micro text-fg-faint"><span role="status" aria-live="polite" className="flex items-center gap-1">{s === "saved" ? <Check className="size-3.5" /> : s === "saving" ? <span className="lumen-dot animate-pulse" /> : s === "offline" ? <CloudOff className="size-3.5" /> : <TriangleAlert className="size-3.5 text-danger" />}{s === "saved" ? "Saved" : s === "saving" ? "Saving…" : s === "offline" ? "Offline · kept on this device" : s === "conflict" ? "Changed elsewhere — open the page to resolve" : "Not saved"}</span><Link href={`/p/${page.id}`} className="ml-auto flex items-center gap-1 hover:text-fg"><ExternalLink className="size-3.5" />Open as main page</Link></div>
      <textarea value={title} onChange={(e) => { setTitle(e.target.value); sync.queue({ title: e.target.value }); }} rows={1} placeholder="Untitled" aria-label="Side page title" disabled={Boolean(page.deletedAt)} style={{ outline: "none" }} className="page-title mt-2 w-full resize-none overflow-hidden bg-transparent text-h2 outline-none [field-sizing:content] placeholder:text-fg-faint/70" />
      <Editor content={page.content} pageId={page.id} editable={!page.deletedAt && s !== "conflict"} embedded className="mt-2" onReady={(e) => { editorRef.current = e; }} onLock={(l) => { lock.current = l; }} onChange={(d) => { if (lock.current) return; doc.current = d; sync.queue({ content: d }); }} />
    </div>
  );
}

