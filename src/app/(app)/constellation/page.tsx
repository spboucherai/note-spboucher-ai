import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { Constellation } from "@/components/knowledge/Constellation";
export const metadata = { title: "Thought Constellation — Note SPBoucher AI" };
export default async function ConstellationPage() { const u = await requireUserPage(); await getWorkspace(u.id); return <Constellation />; }
