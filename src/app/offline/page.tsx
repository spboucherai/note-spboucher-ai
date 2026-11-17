import { OfflineScreen } from "@/components/auth/OfflineScreen";
export const metadata = { title: "Offline" };
/** Static, public, contains nothing personal: this is the only page the service worker keeps. */
export default function Offline() { return <OfflineScreen />; }
