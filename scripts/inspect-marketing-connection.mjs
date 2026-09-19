const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('The existing Cloudflare operator connection is required.');
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
const root=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const response=await fetch(`${root}?name=becore-tickets-db`,{headers,signal:AbortSignal.timeout(30000)});
const listed=await response.json(),matches=listed.result?.filter(row=>row.name==='becore-tickets-db');
if(!response.ok||!listed.success||matches?.length!==1)throw new Error('Could not resolve the production database.');
const query=async sql=>{
 const response=await fetch(`${root}/${matches[0].uuid}/query`,{method:'POST',headers,body:JSON.stringify({sql}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();if(!response.ok||!result.success||!result.result?.[0]?.success)throw new Error('Could not inspect marketing connection state.');
 return result.result[0].results;
};
let connection;
for(let attempt=0;attempt<12;attempt++){
 connection=await query("SELECT status,contact_count,reserved_count,checked_at,error FROM marketing_state WHERE id='resend'");
 if(connection[0]?.status!=="checking")break;
 await new Promise(resolve=>setTimeout(resolve,15000));
}
console.log(JSON.stringify({connection:await query("SELECT status,contact_count,reserved_count,checked_at,error FROM marketing_state WHERE id='resend'"),
 contacts:await query('SELECT COUNT(*) AS synced_contacts,SUM(unsubscribed) AS unsubscribed FROM marketing_contacts WHERE provider_id IS NOT NULL'),
 campaigns:await query('SELECT status,COUNT(*) AS count FROM marketing_campaigns GROUP BY status')},null,2));
