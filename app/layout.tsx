import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ReachPulse · WhatsApp Business Campaign Platform",
  description: "WhatsApp Business marketing and campaign management workspace",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
