import type { Metadata } from "next";

/** Separate installed identity; customer installs keep their existing manifest. */
export const staffAppMetadata: Metadata = {
  applicationName: "BeCore Staff",
  manifest: "/staff.webmanifest?v=1",
  appleWebApp: { capable: true, title: "BeCore Staff", statusBarStyle: "default" },
};

export const scannerAppMetadata: Metadata = {
  applicationName: "BeCore Scanner",
  title: "Ticket scanner",
  robots: { index: false, follow: false },
  manifest: "/scanner.webmanifest?v=1",
  appleWebApp: { capable: true, title: "BeCore Scanner", statusBarStyle: "default" },
};
