import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BeCore Tickets — Accra's party shortlist",
  description: "A weekly edit of selected parties in Accra, with secure Mobile Money ticketing by BeCoreOps.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
