const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error("Cloudflare secret missing");
const zone="/zones/bbf0174f839a0d22dbf6d9f4bd3cf53d", account="/accounts/af75a230de2eea882606db8d9acce473";
const domain="becoreops.com", destination="bechirobob@gmail.com";
async function api(path,method="GET",body){
 const response=await fetch("https://api.cloudflare.com/client/v4"+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok||!data.success)throw new Error(method+" "+path+" "+JSON.stringify(data.errors));
 return data.result;
}
const addresses=await api(account+"/email/routing/addresses");
if(!addresses.find(d=>d.email===destination&&d.verified))throw new Error("Owner Gmail must be verified before any mail migration");
let rules=await api(zone+"/email/routing/rules");
for(const local of ["tickets","bechirobob"]){
 const address=local+"@"+domain;
 const existing=rules.filter(r=>r.matchers.some(m=>m.type==="literal"&&m.field==="to"&&m.value===address));
 if(existing.length>1)throw new Error("Duplicate rule: "+address);
 if(existing.length&&!(existing[0].enabled&&existing[0].actions.length===1&&existing[0].actions[0].type==="forward"&&JSON.stringify(existing[0].actions[0].value)===JSON.stringify([destination])))throw new Error("Conflicting rule: "+address);
 if(!existing.length)await api(zone+"/email/routing/rules","POST",{name:address+" to owner Gmail",enabled:true,matchers:[{type:"literal",field:"to",value:address}],actions:[{type:"forward",value:[destination]}],priority:local==="tickets"?0:1});
}
const settings=await api(zone+"/email/routing");
if(settings.enabled){console.log(JSON.stringify({alreadyEnabled:true,settings,rules:await api(zone+"/email/routing/rules")}));process.exit(0);}
const records=await api(zone+"/dns_records?per_page=500");
const oldMx=records.filter(r=>r.name===domain&&r.type==="MX");
const oldSpf=records.filter(r=>r.name===domain&&r.type==="TXT"&&r.content.replaceAll('"',"").startsWith("v=spf1 "));
if(oldMx.length!==1||oldMx[0].content!=="webhost.dynadot.com"||oldSpf.length!==1)throw new Error("Unexpected existing root mail DNS; review required");
const required=await api(zone+"/email/routing/dns");
if(!Array.isArray(required)||required.filter(r=>r.type==="MX").length!==3)throw new Error("Unexpected required DNS");
const body=r=>({name:r.name,type:r.type,content:r.content,ttl:r.ttl||1,...(r.priority!==undefined?{priority:r.priority}:{})});
console.log(JSON.stringify({rollbackSnapshot:[...oldMx,...oldSpf].map(r=>({id:r.id,...body(r)}))}));
const posts=required.filter(r=>r.type!=="TXT"||!r.content.replaceAll('"',"").startsWith("v=spf1 ")).map(body);
if(posts.some(r=>records.some(e=>e.name===r.name&&e.type===r.type&&e.content===r.content)))throw new Error("Required DNS already partially present; review");
const mergedSpf=oldSpf[0].content.replace("v=spf1 ","v=spf1 include:_spf.mx.cloudflare.net ");
const changes=await api(zone+"/dns_records/batch","POST",{deletes:oldMx.map(r=>({id:r.id})),patches:[{id:oldSpf[0].id,content:mergedSpf}],posts});
try{
 const enabled=await api(zone+"/email/routing/dns","POST",{name:domain});
 console.log(JSON.stringify({enableResult:enabled,settings:await api(zone+"/email/routing"),rules:await api(zone+"/email/routing/rules")}));
}catch(error){
 // Restore only this operation's public DNS changes if provider activation fails.
 const now=await api(zone+"/email/routing");
 if(now.enabled){console.log(JSON.stringify({enabledDespiteResponse:true,settings:now}));throw error;}
 const live=await api(zone+"/dns_records?per_page=500");
 const created=live.filter(r=>posts.some(p=>p.name===r.name&&p.type===r.type&&p.content.replace(/\.$/,"")===r.content.replace(/\.$/,"")));
 await api(zone+"/dns_records/batch","POST",{deletes:created.map(r=>({id:r.id})),patches:[{id:oldSpf[0].id,content:oldSpf[0].content}],posts:oldMx.map(body)});
 console.log("ROLLED_BACK_ROOT_MAIL_DNS");
 throw error;
}
