import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { ModelsDashboard } from "@/components/ai/models/ModelsDashboard";
export const metadata = { title: "AI models — Note SPBoucher AI" };
export default async function AIModelsPage() {
  const user = await requireUserPage(); await getWorkspace(user.id);
  return <ModelsDashboard />;
}
