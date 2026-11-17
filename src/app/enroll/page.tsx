import type { Metadata } from "next";
import { EnrollScreen } from "@/components/auth/EnrollScreen";
export const metadata: Metadata = { title: "Register a passkey", referrer: "no-referrer" };
export const dynamic = "force-dynamic";
/** Public page; useless without the one-time token carried in the URL fragment (never sent to the server in a URL). */
export default function EnrollPage() { return <EnrollScreen />; }
