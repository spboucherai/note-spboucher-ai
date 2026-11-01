import { notFound } from "next/navigation";
import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { getPage, breadcrumb, backlinks, touchOpened } from "@/lib/pages/service";
import { PageView } from "@/components/page/PageView";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await requireUserPage(); const ws = await getWorkspace(user.id);
  let page; try { page = await getPage(ws.id, id, { includeDeleted: true }); } catch { notFound(); }
  const [crumbs, back] = await Promise.all([breadcrumb(ws.id, id), backlinks(ws.id, id)]);
  touchOpened(id).catch(() => {});
  return <PageView key={id} page={JSON.parse(JSON.stringify(page))} breadcrumb={crumbs} backlinks={JSON.parse(JSON.stringify(back))} />;
}
