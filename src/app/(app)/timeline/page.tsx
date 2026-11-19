import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { Timeline } from "@/components/knowledge/Timeline";
export const metadata = { title: "Timeline — Note SPBoucher AI" };
const id = (s?: string) => (s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null);
export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ pageId?: string; projectId?: string }> }) {
  const u = await requireUserPage(); await getWorkspace(u.id); const q = await searchParams;
  return <Timeline initial={{ pageId: id(q.pageId), projectId: id(q.pageId) ? null : id(q.projectId) }} />;
}
