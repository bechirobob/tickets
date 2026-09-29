import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cloudflare, account } from '../handover/control-client.mjs';
import { archiveSql } from './worker.mjs';
const base='/accounts/'+account, source=base+'/workers/scripts/becore-tickets';
const name='tickets-handover-terminal', target=base+'/workers/scripts/'+name;
const before=await cloudflare(source+'/settings');
assert.equal(before.bindings.find(b=>b.name==='RELEASE_SHA')?.text,'18d1a08e0e77f862870aecd6b9fbcec4705c3bb8');
const database=before.bindings.find(b=>b.name==='DB'&&b.type==='d1').id;
await cloudflare(base+'/d1/database/'+database+'/query','POST',{sql:archiveSql});
const form=new FormData();
form.set('metadata',JSON.stringify({main_module:'terminal.mjs',compatibility_date:'2026-08-11',bindings:[{name:'DB',type:'d1',id:database}],observability:{enabled:true,head_sampling_rate:1}}));
form.set('terminal.mjs',new Blob([await readFile(new URL('./worker.mjs',import.meta.url),'utf8')],{type:'application/javascript+module'}),'terminal.mjs');
await cloudflare(target,'PUT',form);
await cloudflare(target+'/subdomain','POST',{enabled:false,previews_enabled:false});
const settings=await cloudflare(source+'/script-settings');
const consumers=settings.tail_consumers??[];
await cloudflare(source+'/script-settings','PATCH',{tail_consumers:[...consumers.filter(c=>c.service!==name),{service:name}]});
const after=await cloudflare(source+'/settings');
assert.deepEqual(after.bindings,before.bindings);
assert.ok((await cloudflare(source+'/script-settings')).tail_consumers.some(c=>c.service===name));
console.log(JSON.stringify({terminalObserverInstalled:true,publicEndpoint:false,sourceBindingsUnchanged:true,database}));
// Read one recent interval to locate the exact operation/invocation correlation
// fields without printing request URLs, headers or customer data.
const result=await cloudflare(base+'/workers/observability/telemetry/query','POST',{queryId:crypto.randomUUID(),timeframe:{from:Date.parse('2026-09-29T11:29:00Z'),to:Date.parse('2026-09-29T11:29:30Z')},view:'events',limit:2000,parameters:{filters:[{key:'$metadata.service',operation:'eq',type:'string',value:'becore-tickets'}]}});
const entries=result.events.events;
const sample=entries.find(e=>JSON.stringify(e).includes('handoverOperation'));
const terminal=entries.find(e=>e.$metadata?.type==='cf-worker-event');
for(const [type,e] of [['operation',sample],['terminal',terminal]])if(e)console.log(JSON.stringify({sampleType:type,keys:Object.keys(e),sourceKeys:Object.keys(e.source??{}),workerKeys:Object.keys(e.$workers??{}),metadataKeys:Object.keys(e.$metadata??{}),sourceOperation:e.source?.handoverOperation,rootOperation:e.handoverOperation,workerRequestId:e.$workers?.requestId,metadataRequestId:e.$metadata?.requestId,sourceMessage:e.source?.message?.includes?.('handoverOperation')?e.source.message:undefined,metadataMessage:e.$metadata?.message?.includes?.('handoverOperation')?e.$metadata.message:undefined}));
