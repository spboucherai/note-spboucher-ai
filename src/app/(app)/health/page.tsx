import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { HealthDashboard } from "@/components/knowledge/Health";
export const metadata = { title: "Knowledge Health — Note SPBoucher AI" };
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) { const u = await requireUserPage(); await getWorkspace(u.id); const { show } = await searchParams; return <HealthDashboard initial={show ?? null} />; }
