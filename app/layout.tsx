import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "ReachPulse · Amplifying Your Reach", description: "ReachPulse WhatsApp Business campaign workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
