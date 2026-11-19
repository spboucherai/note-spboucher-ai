import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { KnowledgeGraph } from "@/components/knowledge/KnowledgeGraph";
export const metadata = { title: "Graph — Note SPBoucher AI" };
/** /graph[?view=global|local|project|timeline|concepts|documents|references&pageId=<id>] — `?focus=<id>` (2.x links) opens the local view of that page. */
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ focus?: string; view?: string; pageId?: string; panel?: string; new?: string }> }) {
  const user = await requireUserPage(); await getWorkspace(user.id);
  const { focus, view, pageId, panel, new: create } = await searchParams;
  return <KnowledgeGraph initial={{ view: view ?? null, pageId: pageId ?? focus ?? null, panel: panel ?? null, create: create ?? null }} />;
}
