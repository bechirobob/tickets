import type { Metadata } from "next";
import CustomerDock from "./customer-dock";
import PwaRegistration from "./pwa-registration";
import AnalyticsBeacon from "./analytics-beacon";
import "./globals.css";
import "./access-polish.css";
import "./discovery.css";
import "./room-experience.css";
import "./interface-finish.css";
import "./nightlife-details.css";
import "./brand-identity.css";
import "./backstage.css";
import "./room-atmosphere.css";
import "./your-nights.css";
import "./room-conversation.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://tickets.becoreops.com"),
  title: {
    default: "BeCore Tickets — Accra's party shortlist",
    template: "%s · BeCore Tickets",
  },
  description: "Accra nights worth leaving the house for. Pick your party, pay with MoMo or card and meet your people in The Room.",
  applicationName: "BeCore Tickets",
  openGraph: {
    type: "website",
    locale: "en_GH",
    siteName: "BeCore Tickets",
    title: "BeCore Tickets — Accra's party shortlist",
    description: "Give the group chat an actual plan. Accra parties, MoMo or card tickets and a private Room for the people going.",
    url: "/",
    images: [{ url: "/social-card.png", width: 1200, height: 630, alt: "BeCore Tickets — Accra's edited night out" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BeCore Tickets — Accra's party shortlist",
    description: "Give the group chat an actual plan. Accra parties, MoMo or card tickets and a private Room for the people going.",
    images: ["/social-card.png"],
  },
  manifest: "/manifest.webmanifest",
  themeColor: "#281b2b",
  icons: {
    icon: [
      { url: "/favicon.ico?v=3", sizes: "any" },
      { url: "/favicon.svg?v=3", type: "image/svg+xml" },
      { url: "/favicon-32x32.png?v=3", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=3",
    apple: [{ url: "/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" }],
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
