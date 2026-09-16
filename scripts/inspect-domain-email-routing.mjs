const root="https://api.cloudflare.com/client/v4";
const account="af75a230de2eea882606db8d9acce473";
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error("Cloudflare token missing");
async function cf(path){
 const r=await fetch(root+path,{headers:{authorization:"Bearer "+token}});
 const j=await r.json();
 if(!r.ok||!j.success)throw new Error(path+" HTTP "+r.status+" "+JSON.stringify(j.errors));
 return j.result;
}
const zones=await cf("/zones?name=becoreops.com");
if(zones.length!==1)throw new Error("Expected one domain");
const z=zones[0].id;
console.log("zone",z);
for(const [name,path] of [
 ["settings","/zones/"+z+"/email/routing"],
 ["dns","/zones/"+z+"/email/routing/dns"],
 ["addresses","/accounts/"+account+"/email/routing/addresses"],
 ["rules","/zones/"+z+"/email/routing/rules"],
 ["mx","/zones/"+z+"/dns_records?type=MX"],
 ["txt","/zones/"+z+"/dns_records?type=TXT&name=becoreops.com"]
]) { try { console.log(name,JSON.stringify(await cf(path))); } catch(e) {console.log(name,e.message);process.exitCode=1;} }
