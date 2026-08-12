import type { Metadata } from "next";
import CustomerDock from "./customer-dock";
import PwaRegistration from "./pwa-registration";
import "./globals.css";
import "./access-polish.css";

export const metadata: Metadata = {
  title: "BeCore Tickets — Accra's party shortlist",
  description: "A weekly edit of selected parties in Accra, with secure Mobile Money ticketing by BeCoreOps.",
  manifest: "/manifest.webmanifest",
  themeColor: "#0b0c0b",
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "any" },
      { url: "/favicon.svg?v=2", type: "image/svg+xml" },
      { url: "/favicon-32x32.png?v=2", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: [{ url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <head><link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" /></head>
      <body>{children}<CustomerDock /><PwaRegistration /></body>
    </html>
  );
}
