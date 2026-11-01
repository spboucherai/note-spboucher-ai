import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { listTree } from "@/lib/pages/service";
import { Shell } from "@/components/shell/Shell";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage(); const ws = await getWorkspace(user.id);
  const tree = await listTree(ws.id);
  return <Shell user={{ id: user.id, username: user.username, displayName: user.displayName }} workspace={{ id: ws.id, name: ws.name }} initialTree={tree.map((p) => ({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, type: p.type, section: p.section, pinned: p.pinned, updatedAt: p.updatedAt.toISOString() }))}>{children}</Shell>;
}
