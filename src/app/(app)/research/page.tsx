import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { ResearchOverview } from "@/components/research/ResearchOverview";
export const metadata = { title: "Research — Note SPBoucher AI" };
export default async function ResearchPage() { const user = await requireUserPage(); await getWorkspace(user.id); return <ResearchOverview />; }
