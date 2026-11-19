import { OfflineApp } from "@/components/offline/OfflineApp";
export const metadata = { title: "Offline" };
/**
 * Static, public, contains nothing personal: this is the only page the service worker keeps (the app shell it serves for any navigation
 * that cannot reach the server). Everything it shows is read in the browser from the device replica (IndexedDB), never from this HTML.
 */
export default function Offline() { return <OfflineApp />; }
