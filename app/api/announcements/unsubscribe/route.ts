import { mutationHasValidOrigin } from '../../../../lib/admin-session';
export async function POST(request: Request) {
  if(!mutationHasValidOrigin(request))return Response.json({error:'This request was not accepted.'},{status:403});
  const form=await request.formData().catch(()=>null),token=form?.get('token');
  if(typeof token!=='string'||token.length<32||token.length>200)return Response.json({error:'Use the unsubscribe link in your email.'},{status:400});
  const {env}=await import('cloudflare:workers');
  await env.DB.prepare('UPDATE event_audience_contacts SET unsubscribed_at=? WHERE unsubscribe_token=?').bind(new Date().toISOString(),token).run();
  return new Response(null,{status:303,headers:{location:'/announcements/unsubscribe?done=1','cache-control':'no-store'}});
}
