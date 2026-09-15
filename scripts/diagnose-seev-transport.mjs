import { randomBytes, createHash } from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const account='af75a230de2eea882606db8d9acce473';
const token=process.env.CLOUDFLARE_API_TOKEN;
const name='becore-seev-diagnostic-'+process.env.GITHUB_RUN_ID;
if(!token || !/^becore-seev-diagnostic-\d+$/.test(name)) throw new Error('Missing diagnostic configuration');
const root='https://api.cloudflare.com/client/v4';
const auth={authorization:'Bearer '+token};
async function cf(path,method='GET',body){
 const res=await fetch(root+path,{method,headers:{...auth,...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await res.json();
 if(!res.ok || !data.success) throw new Error('Cloudflare '+method+' '+path+' failed: '+res.status+' '+JSON.stringify(data.errors?.map(e=>({code:e.code,message:e.message}))));
 return data.result;
}
const scriptPath='/accounts/'+account+'/workers/scripts/'+name;
const guard=randomBytes(32).toString('hex');
const worker=String.raw`
import {connect} from 'cloudflare:sockets';
import {requestSeev} from './seev-transport.mjs';
const api='https://api.seevplus.com/api/v1/developer/payments';
async function probe(method){
 const res=await fetch(api+(method==='GET'?'/NOT-A-PAYMENT':''),{method,headers:method==='POST'?{'content-type':'application/json'}:{},body:method==='POST'?'{}':undefined,signal:AbortSignal.timeout(12000),redirect:'manual'});
 const body=await res.text();
 return {transport:'fetch',method,status:res.status,contentType:res.headers.get('content-type'),server:res.headers.get('server'),ray:res.headers.get('cf-ray'),body:body.slice(0,350)};
}
async function socketProbe(host='api.seevplus.com'){
 const s=connect({hostname:host,port:443},{secureTransport:'on'});
 let timer;
 try{
  return await Promise.race([(async()=>{
   await s.opened;
   const writer=s.writable.getWriter();
   await writer.write(new TextEncoder().encode('GET /api/v1/developer/payments/NOT-A-PAYMENT HTTP/1.1\r\nHost: '+host+'\r\nAccept: application/json\r\nConnection: close\r\n\r\n'));
   const reader=s.readable.getReader();let text='';
   while(text.length<8192){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value);}
   return {transport:'tls-socket',response:text.slice(0,1500)};
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TLS probe timeout')),12000)})]);
 }finally{clearTimeout(timer);await s.close().catch(()=>{});}
}
async function invalidCertificateProbe(host){
 try {await socketProbe(host);return {host,certificateRejected:false};}
 catch(error){return {host,certificateRejected:true,error:String(error)};}
}
async function candidateProbe(method){
 const response=await requestSeev(api+(method==='GET'?'/PAY-transport-probe':''), method==='POST'?{method:'POST',headers:{'content-type':'application/json','idempotency-key':'transport-probe-no-credentials'},body:'{}'}:{});
 return {transport:'candidate',method,status:response.status,contentType:response.headers.get('content-type'),body:(await response.text()).slice(0,350)};
}
export default {async fetch(req,env){
 if(req.headers.get('authorization')!=='Bearer '+env.DIAGNOSTIC_TOKEN)return new Response('Not found',{status:404});
 const results=await Promise.allSettled([probe('GET'),probe('POST'),socketProbe(),candidateProbe('GET'),candidateProbe('POST'),invalidCertificateProbe('expired.badssl.com'),invalidCertificateProbe('wrong.host.badssl.com')]);
 return Response.json({colo:req.cf?.colo,results:results.map(r=>r.status==='fulfilled'?r.value:{error:String(r.reason)})});
}};
`;
const results=await Promise.allSettled([
 cf('/zones?name=becoreops.com'),
 cf('/accounts/'+account+'/workers/scripts/becore-tickets/settings'),
 cf('/accounts/'+account+'/workers/subdomain')
]);
for(let i=0;i<results.length;i++){
 const r=results[i];
 if(r.status==='rejected')console.log(JSON.stringify({inspection:i,error:r.reason.message}));
 else if(i===0){for(const zone of r.value){const settings=await cf('/zones/'+zone.id+'/settings').catch(e=>({error:e.message}));console.log(JSON.stringify({zone:zone.name,settings:Array.isArray(settings)?settings.filter(x=>['ssl','min_tls_version','tls_1_3','ciphers','origin_max_http_version'].includes(x.id)):settings}));}}
 else if(i===1)console.log(JSON.stringify({production:{compatibility_date:r.value.compatibility_date,compatibility_flags:r.value.compatibility_flags,bindingNames:r.value.bindings?.map(x=>({name:x.name,type:x.type}))}}));
}
const subdomain=results[2].status==='fulfilled'?results[2].value.subdomain:null;
if(!subdomain)throw new Error('Workers subdomain lookup failed');
const pre=await fetch(root+scriptPath+'/settings',{headers:auth});
if(pre.status!==404)throw new Error('Refusing to overwrite an existing diagnostic Worker: '+pre.status);
let created=false;
try{
 const form=new FormData();
 form.set('metadata',JSON.stringify({main_module:'diagnostic.mjs',compatibility_date:'2026-08-11',compatibility_flags:['nodejs_compat'],bindings:[{type:'secret_text',name:'DIAGNOSTIC_TOKEN',text:guard}]}));
 form.set('diagnostic.mjs',new Blob([worker],{type:'application/javascript+module'}),'diagnostic.mjs');
 const source=await readFile('scripts/seev-transport-candidate.ts','utf8');
 console.log(JSON.stringify({candidateSha256:createHash('sha256').update(source).digest('hex')}));
 form.set('seev-transport.mjs',new Blob([stripTypeScriptTypes(source)],{type:'application/javascript+module'}),'seev-transport.mjs');
 await cf(scriptPath,'PUT',form);created=true;
 await cf(scriptPath+'/subdomain','POST',{enabled:true,previews_enabled:false});
 const baseline=await fetch('https://api.seevplus.com/api/v1/developer/payments/NOT-A-PAYMENT',{signal:AbortSignal.timeout(15000)});
 console.log(JSON.stringify({transport:'node-fetch',status:baseline.status,contentType:baseline.headers.get('content-type'),body:(await baseline.text()).slice(0,350)}));
 const url='https://'+name+'.'+subdomain+'.workers.dev';
 let response;
 for(let attempt=0;attempt<4;attempt++){response=await fetch(url,{headers:{authorization:'Bearer '+guard},signal:AbortSignal.timeout(45000)});if(response.ok)break;await new Promise(r=>setTimeout(r,2000));}
 if(!response.ok)throw new Error('Diagnostic invocation failed '+response.status);
 console.log(JSON.stringify({worker:name,diagnostics:await response.json()}));
}finally{
 if(created){await cf(scriptPath,'DELETE');console.log(JSON.stringify({worker:name,cleanup:'deleted'}));}
}
