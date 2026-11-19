import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { Home as HomeScreen } from "@/components/knowledge/Brief";
export const metadata = { title: "Home" };
export default async function Home() {
  const u = await requireUserPage(); await getWorkspace(u.id);
  return <HomeScreen displayName={u.displayName} />;
}
