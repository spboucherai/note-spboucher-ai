import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { GraphExplorer } from "@/components/graph/GraphExplorer";
export const metadata = { title: "Graph — Note SPBoucher AI" };
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requireUserPage(); await getWorkspace(user.id);
  const { focus } = await searchParams;
  return <GraphExplorer focus={focus && /^[0-9a-f-]{36}$/.test(focus) ? focus : null} />;
}
