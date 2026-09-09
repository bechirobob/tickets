export const dynamic='force-dynamic';
export const metadata={title:'Announcement preferences',robots:{index:false,follow:false}};
export default async function UnsubscribePage({searchParams}:{searchParams:Promise<{token?:string;done?:string}>}) {
  const {token,done}=await searchParams;
  return <main className="announcement-preferences"><h1>{done ? 'You’re unsubscribed' : 'Stop these announcements?'}</h1>{done ? <p>You won’t receive further announcements from this event’s organiser for this event. Your booking remains valid.</p> : token ? <form action="/api/announcements/unsubscribe" method="post"><p>This changes announcement emails for this event. Booking confirmations and essential event updates are separate.</p><input type="hidden" name="token" value={token} /><button type="submit">Unsubscribe</button></form> : <p>Open the unsubscribe link in your announcement email.</p>}</main>;
}
