import { redirect } from "next/navigation";
export default async function OrganizerAssistantPage({searchParams}:{searchParams:Promise<{event?:string}>}) {
  const {event}=await searchParams;
  redirect(`/organizer/workspace?area=desk${typeof event==='string'&&/^[a-z0-9-]{1,80}$/u.test(event)?`&event=${encodeURIComponent(event)}`:''}`);
}
