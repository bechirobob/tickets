const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error("Cloudflare token missing");
async function cf(path, options = {}) {
 const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
  ...options, headers: { authorization: "Bearer " + token, "content-type": "application/json" },
 });
 const body = await response.json();
 if (!response.ok || !body.success) throw new Error("Cloudflare " + response.status + ": " + JSON.stringify(body.errors));
 return body.result;
}
const zones = await cf("/zones?name=becoreops.com");
if (zones.length !== 1) throw new Error("Expected one accessible becoreops.com zone");
const base = "/zones/" + zones[0].id + "/dns_records";
const desired = [
 {type:"TXT",name:"resend._domainkey.becoreops.com",content:"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1FJ7OeSvSwoQjwXHWPmUD1WLoGzP1Qz17sG0Rw+dookkbJ2CiBcjLmrNizBKStYjEd6f2DFM3LJFRHz9fhY5LVWJuU0qZ1MV7KK13sYTBoWwqjHWpbZEbARdPzJAgQFZWBdJn2G/q/Se7aDggjZg2AxsXtqS8VBOULMPoEsmMjwIDAQAB",ttl:1},
 {type:"CNAME",name:"rsend.becoreops.com",content:"rsend-euw1.forge.rmta.net",ttl:1,proxied:false},
 {type:"CNAME",name:"send.becoreops.com",content:"send.forge.rmta.net",ttl:1,proxied:false},
];
const before = await cf(base + "?name=becoreops.com");
console.log("Root mail records preserved:", JSON.stringify(before.filter(r => ["MX","TXT"].includes(r.type)).map(({type,name,content,priority})=>({type,name,content,priority}))));
for (const record of desired) {
 const existing = await cf(base + "?name=" + record.name);
 if (existing.length) {
  if (existing.length === 1 && existing[0].type === record.type && existing[0].content.replace(/^"|"$/g,"") === record.content && !existing[0].proxied) {console.log("Already correct:",record.name);continue;}
  throw new Error("Conflicting DNS record; stopped without overwriting: " + record.name);
 }
 const created = await cf(base,{method:"POST",body:JSON.stringify(record)});
 console.log("Created:",JSON.stringify({id:created.id,type:created.type,name:created.name,content:created.content,proxied:created.proxied}));
}
