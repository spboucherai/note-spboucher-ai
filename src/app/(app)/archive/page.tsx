import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { ArchiveView } from "@/components/inbox/ArchiveView";
export const metadata = { title: "Archive" };
export default async function ArchivePage() { const u = await requireUserPage(); await getWorkspace(u.id); return <ArchiveView />; }
