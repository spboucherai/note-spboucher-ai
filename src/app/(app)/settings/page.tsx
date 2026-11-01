import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { SettingsView } from "@/components/settings/SettingsView";
import pkg from "../../../../package.json";
export const metadata = { title: "Settings" };
export default async function SettingsPage() { const u = await requireUserPage(); await getWorkspace(u.id); return <SettingsView version={pkg.version} />; }
