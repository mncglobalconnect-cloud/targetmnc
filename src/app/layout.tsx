import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MNC Groups — Target & Lead Management", template: "%s · MNC Targets" },
  description: "Daily target, achievement and lead management for MNC Groups teams.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d53f0" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
