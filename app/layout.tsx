import type { Metadata } from "next";
import CustomerDock from "./customer-dock";
import PwaRegistration from "./pwa-registration";
import AnalyticsBeacon from "./analytics-beacon";
import "./globals.css";
import "./access-polish.css";
import "./discovery.css";
import "./room-experience.css";
import "./interface-finish.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://tickets.becoreops.com"),
  title: {
    default: "BeCore Tickets — Accra's party shortlist",
    template: "%s · BeCore Tickets",
  },
  description: "A weekly edit of selected parties in Accra, with secure Mobile Money and card ticketing by BeCoreOps.",
  applicationName: "BeCore Tickets",
  openGraph: {
    type: "website",
    locale: "en_GH",
    siteName: "BeCore Tickets",
    title: "BeCore Tickets — Accra's party shortlist",
    description: "Selected Accra nights, secure Mobile Money or card checkout and private event Rooms.",
    url: "/",
    images: [{ url: "/social-card.png", width: 1200, height: 630, alt: "BeCore Tickets — Accra's edited night out" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BeCore Tickets — Accra's party shortlist",
    description: "Selected Accra nights, secure Mobile Money or card checkout and private event Rooms.",
    images: ["/social-card.png"],
  },
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
      <body>{children}<CustomerDock /><AnalyticsBeacon /><PwaRegistration /></body>
    </html>
  );
}
