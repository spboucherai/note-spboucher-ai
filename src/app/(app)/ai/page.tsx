import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { AskPage } from "@/components/knowledge/AskPage";
export const metadata = { title: "Ask My Knowledge — Note SPBoucher AI" };
export default async function AskRoute({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) { const u = await requireUserPage(); await getWorkspace(u.id); const { c, q } = await searchParams; return <AskPage conversationId={c && /^[0-9a-f-]{36}$/i.test(c) ? c : null} prefill={q ? q.slice(0, 2000) : null} />; }
