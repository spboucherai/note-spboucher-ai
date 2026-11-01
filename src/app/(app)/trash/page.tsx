import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { TrashView } from "@/components/trash/TrashView";
export const metadata = { title: "Trash" };
export default async function TrashPage() { const u = await requireUserPage(); await getWorkspace(u.id); return <TrashView />; }
