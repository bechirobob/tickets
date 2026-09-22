import { couponQuote } from '../../../../lib/organizer-promotions';
import { OrganizerError, privateHeaders } from '../../../../lib/organizer-access';
import { mutationHasValidOrigin, hashToken, requestMetadata } from '../../../../lib/admin-session';
import { enforceRateLimit } from '../../../../lib/security-controls';
import { findCuratedEvent } from '../../../events';
import { resolveTicketSelection } from '../../../../lib/ticket-selection';
export async function POST(request:Request){
  if(!mutationHasValidOrigin(request))return Response.json({error:'Request not accepted.'},{status:403,headers:privateHeaders});
  const {env}=await import('cloudflare:workers');
  if(!await enforceRateLimit(env.PAYMENT_NETWORK_RATE_LIMITER,`coupon:${await hashToken(requestMetadata(request).ip??'unknown')}`))return Response.json({error:'Give it a minute before trying another code.'},{status:429,headers:privateHeaders});
  try{
    const raw=await request.text();if(raw.length>2048)throw new OrganizerError('Request too large.',413);
    const b=JSON.parse(raw) as Record<string,unknown>;
    if(typeof b.eventSlug!=='string'||typeof b.code!=='string'||b.code.length>32||typeof b.tierId!=='string')throw new OrganizerError('Choose tickets and a code.');
    const event=await findCuratedEvent(b.eventSlug);
    const selection=event?resolveTicketSelection(event,b.tierId,b.quantity):null;
    if(!event||!selection)throw new OrganizerError('These tickets are unavailable.');
    return Response.json(await couponQuote(env.DB,event.slug,selection.tier.recordId,b.code,selection.faceAmountMinor,event.bookingFeeBasisPoints),{headers:privateHeaders});
  }catch(error){return Response.json({error:error instanceof OrganizerError?error.message:'The code could not be checked.'},{status:error instanceof OrganizerError?error.status:400,headers:privateHeaders});}
}
