import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { TasksInbox } from "@/components/tasks/TasksInbox";
export const metadata = { title: "Tasks" };
export default async function TasksPage() { const u = await requireUserPage(); await getWorkspace(u.id); return <TasksInbox />; }
