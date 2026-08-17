import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fontVariableClassName } from "@/lib/theme/fonts";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ServiceWorkerRegistrar } from "@/components/providers/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "drip",
  description: "paste anything. scroll it in.",
  applicationName: "drip",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "drip" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariableClassName} suppressHydrationWarning>
      <body>
        <QueryProvider>
          <div className="app-shell">{children}</div>
        </QueryProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
