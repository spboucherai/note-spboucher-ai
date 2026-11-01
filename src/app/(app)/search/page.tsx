import { requireUserPage } from "@/lib/auth/guard";
import { SearchPage } from "@/components/search/SearchPage";
export const metadata = { title: "Search" };
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) { await requireUserPage(); const { q } = await searchParams; return <SearchPage initialQuery={q ?? ""} />; }
