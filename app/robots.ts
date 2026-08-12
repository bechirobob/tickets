import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/account",
        "/admin",
        "/api",
        "/checkout",
        "/my-nights",
        "/notifications",
        "/organizer/workspace",
        "/payment",
        "/room",
        "/scan",
        "/tickets",
      ],
    },
    sitemap: "https://tickets.becoreops.com/sitemap.xml",
    host: "https://tickets.becoreops.com",
  };
}
