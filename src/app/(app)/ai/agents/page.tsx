import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { AgentsConsole } from "@/components/ai/agents/AgentsConsole";
export const metadata = { title: "Agents — Note SPBoucher AI" };
export default async function AIAgentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUserPage(); await getWorkspace(user.id);
  const { page } = await searchParams;
  return <AgentsConsole initialPageId={page && /^[0-9a-f-]{36}$/.test(page) ? page : null} />;
}
