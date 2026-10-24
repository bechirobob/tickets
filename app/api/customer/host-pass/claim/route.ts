import { mutationHasValidOrigin } from '../../../../../lib/admin-session';
import { attendeeCookieHeader, readAttendeeIdentity } from '../../../../../lib/attendee-auth';
import { claimHostPass } from '../../../../../lib/event-host-pass';
import { limitRequestBody } from '../../../../../lib/request-body';
import { customerAccessHeaders, readAccessToken } from '../../../../../lib/ticket-recovery';
export async function POST(request:Request) {
 const bounded=await limitRequestBody(request,512);if(bounded instanceof Response)return bounded;request=bounded;
 const headers=customerAccessHeaders();
 if(!mutationHasValidOrigin(request))return Response.json({error:'This pass request was not accepted.'},{status:403,headers});
 const token=await readAccessToken(request);
 try {
  if(!token)throw new Error();
  const {env}=await import('cloudflare:workers');
  const current=await readAttendeeIdentity(env.DB,request.headers.get('cookie'));
  const result=await claimHostPass(env,token,current?.normalizedEmail);
  return Response.json({redirectTo:result.redirectTo,eventSlug:result.eventSlug},{headers:{...headers,'set-cookie':attendeeCookieHeader(result.sessionToken)}});
 }catch{return Response.json({error:'This private pass link is unavailable or has already been used. If you are signed in to a different guest account, sign out first.'},{status:409,headers});}
}
