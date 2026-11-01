import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { ComparePanel } from "@/components/ai/compare/ComparePanel";
export const metadata = { title: "Compare models — Note SPBoucher AI" };
export default async function AIComparePage() {
  const user = await requireUserPage(); await getWorkspace(user.id);
  return <ComparePanel />;
}
