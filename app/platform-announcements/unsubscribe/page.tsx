import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "BeCore email preferences", robots: { index: false, follow: false } };

export default async function PlatformUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;
  return <main className="announcement-preferences"><h1>{done === "1" ? "Email preference received" : "Stop BeCore announcements?"}</h1>{done === "1" ? <p>A valid current link stops BeCore Tickets announcements. Your bookings and important service updates stay unchanged.</p> : token ? <form action="/api/platform-announcements/unsubscribe" method="post"><p>Your tickets and RSVPs stay valid.</p><input type="hidden" name="token" value={token} /><button type="submit">Unsubscribe</button></form> : <p>Open the unsubscribe link in your announcement email.</p>}<Link href="/account/privacy">Manage email preferences</Link></main>;
}
