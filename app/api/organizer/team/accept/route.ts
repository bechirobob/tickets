import { hashToken,mutationHasValidOrigin,requestMetadata } from '../../../../../lib/admin-session';
import { inspectTeamInvite,acceptTeamInvite } from '../../../../../lib/organizer-team';
import { OrganizerError,privateHeaders } from '../../../../../lib/organizer-access';
import { enforceRateLimit } from '../../../../../lib/security-controls';
export async function POST(request:Request){
  if(!mutationHasValidOrigin(request))return Response.json({error:'Request not accepted.'},{status:403,headers:privateHeaders});
  const {env}=await import('cloudflare:workers');
  try{
    if(!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`team-invite:${await hashToken(requestMetadata(request).ip??'unknown')}`))throw new OrganizerError('Too many attempts. Give it a minute.',429);
    const raw=await request.text();if(raw.length>4096)throw new OrganizerError('Request too large.',413);
    const b=JSON.parse(raw);if(typeof b.token!=='string')throw new OrganizerError('Open your private invitation link.');
    if(b.action==='inspect'){const invite=await inspectTeamInvite(env.DB,b.token);if(!invite)throw new OrganizerError('This invitation expired or was withdrawn.');return Response.json({email:invite.email,role:invite.role,eventTitle:invite.eventTitle,needsPassword:Boolean(invite.needsPassword)},{headers:privateHeaders});}
    if(b.action!=='accept')throw new OrganizerError('Choose an action.');
    return Response.json(await acceptTeamInvite(env.DB,b.token,b),{headers:privateHeaders});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Invitation not accepted.'},{status:error instanceof OrganizerError?error.status:400,headers:privateHeaders});}
}
