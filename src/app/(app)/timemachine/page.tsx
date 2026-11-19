import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { TimeMachine } from "@/components/knowledge/TimeMachine";
export const metadata = { title: "Time Machine — Note SPBoucher AI" };
const id = (s?: string) => (s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null);
export default async function TimeMachinePage({ searchParams }: { searchParams: Promise<{ pageId?: string; projectId?: string; at?: string }> }) {
  const u = await requireUserPage(); await getWorkspace(u.id); const q = await searchParams;
  return <TimeMachine initial={{ pageId: id(q.pageId), projectId: id(q.pageId) ? null : id(q.projectId), at: q.at ?? null }} />;
}
