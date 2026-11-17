import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
/** Public, neutral sign-in page. It renders nothing private and loads no workspace data. */
export default function LoginPage() { return <LoginScreen />; }
