import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { InboxView } from "@/components/inbox/InboxView";
export const metadata = { title: "Inbox" };
export default async function InboxPage() { const u = await requireUserPage(); await getWorkspace(u.id); return <InboxView />; }
