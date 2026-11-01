import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "Note SPBoucher AI", template: "%s · Note SPBoucher AI" },
  description: "Private AI-native knowledge operating system.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Note" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fcfcfb" }, { media: "(prefers-color-scheme: dark)", color: "#141518" }], viewportFit: "cover", width: "device-width", initialScale: 1, maximumScale: 1, interactiveWidget: "resizes-content" };

const themeScript = `(function(){try{var t=localStorage.getItem('note-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="font-sans"><Providers>{children}</Providers><Toaster /></body>
    </html>
  );
}
