import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { BacklinksExplorer } from "@/components/graph/BacklinksExplorer";
export const metadata = { title: "Backlinks — Note SPBoucher AI" };
export default async function BacklinksPage() {
  const user = await requireUserPage(); await getWorkspace(user.id);
  return <BacklinksExplorer />;
}
