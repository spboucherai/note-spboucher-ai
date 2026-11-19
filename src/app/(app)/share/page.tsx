import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { ShareCapture } from "@/components/shell/ShareCapture";
import { InboxView } from "@/components/inbox/InboxView";
export const metadata = { title: "Share to SP Note" };
/** Web Share Target landing (`/share?title=&text=&url=`): the inbox, with the quick-capture sheet open on what was shared. */
export default async function SharePage({ searchParams }: { searchParams: Promise<{ title?: string; text?: string; url?: string }> }) {
  const u = await requireUserPage(); await getWorkspace(u.id); const q = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "");
  return <><ShareCapture title={one(q.title)} text={one(q.text)} url={one(q.url)} /><InboxView /></>;
}
