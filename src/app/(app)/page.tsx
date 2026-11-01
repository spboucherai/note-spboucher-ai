import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { Dashboard } from "@/components/dashboard/Dashboard";
export const metadata = { title: "Home" };
export default async function Home() {
  const u = await requireUserPage(); await getWorkspace(u.id);
  return <Dashboard displayName={u.displayName} />;
}
