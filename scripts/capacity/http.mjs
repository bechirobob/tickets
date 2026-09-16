import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';

// No target URL argument: this harness can only hit its own loopback Worker.
// No credentials or remote bindings are inherited by the test process.
const base = 'http://127.0.0.1:8797';
const configPath = 'dist/server/wrangler.capacity.json';
const state = 'work/capacity-http';
const output = 'capacity-results';
mkdirSync(state,{recursive:true}); mkdirSync(output,{recursive:true});
const config = JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
config.name='becore-tickets-capacity-http';config.routes=[];config.workers_dev=false;
config.vars={ENVIRONMENT:'test'};delete config.triggers;delete config.queues;delete config.ai;delete config.images;delete config.observability;
config.d1_databases=[{binding:'DB',database_name:'capacity-local-only',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:'../../drizzle'}];
writeFileSync(configPath,JSON.stringify(config));
const childEnv={...process.env, WRANGLER_LOG:'debug'};
for(const key of Object.keys(childEnv)) if(/CLOUDFLARE|SEEV_|RESEND_|PAYSTACK_|OPENAI_|ADMIN_ACCESS|VAPID_/u.test(key))delete childEnv[key];
const wrangler=args=>execFileSync('npx',['wrangler',...args,'--config',configPath],{env:childEnv,stdio:'pipe'});
wrangler(['d1','migrations','apply','DB','--local','--persist-to',state]);
const now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString(),slug=`capacity-http-${Date.now()}`;
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const sql=[`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES (${q(slug)},${q(slug)},${q(slug)},'HTTP capacity fixture','Local','Accra',${q(future)},${q(future)},'Late night',10000,400,'on_sale','https://example.com/test.jpg','Synthetic local HTTP benchmark.','published',${q(now)},${q(now)},${q(now)});`];
const tokens=[];
for(let i=0;i<400;i++){
  const id=`${slug}-${i}`,token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');tokens.push(token);
  sql.push(`INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES (${q(id)},${q(`${id}@example.com`)},${q(`Guest ${i}`)},'active',${q(now)},${q(now)});`,
    `INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (${q(id)},${q(id)},${q(hash)},${q(future)},${q(now)},${q(now)});`,
    `INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,status,created_at,paid_at) VALUES (${q(id)},${q(id)},${q(slug)},1,10000,0,10000,'GHS',${q(`${id}@example.com`)},'233000000000',${q(`Guest ${i}`)},'card','paid',${q(now)},${q(now)});`,
    `INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES (${q(id)},${q(id)},${q(slug)},'general',${q(id)},'issued',${q(now)});`,
    `INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (${q(id)},${q(id)},'fixture','active',${q(now)});`);
}
writeFileSync(`${state}/fixture.sql`,sql.join('\n'));wrangler(['d1','execute','DB','--local','--persist-to',state,'--file',`${state}/fixture.sql`]);
const log=createWriteStream(`${output}/http-worker.log`);
const server=spawn('npx',['wrangler','dev','--config',configPath,'--local','--persist-to',state,'--port','8797'],{env:childEnv,stdio:['ignore','pipe','pipe'],detached:true});
server.stdout.pipe(log);server.stderr.pipe(log);
const serverExit = { code: null, signal: null };
server.on('exit',(code,signal)=>{serverExit.code=code;serverExit.signal=signal;console.log(JSON.stringify({name:'local-server-exit',code,signal}));});
const metrics=[];
const percentile=(values,p)=>Math.round([...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]??0);
async function request(i,path='/api/customer/my-nights'){
  const start=performance.now();
  const response=await fetch(`${base}${path}`,{headers:{cookie:`bct_attendee=${tokens[i%400]}`},signal:AbortSignal.timeout(30000)}).catch(error=>{throw Error(`${error.message}; cause: ${error.cause?.code ?? ''} ${error.cause?.message ?? ''}`);});
  const data=await response.json();
  if(response.status!==200 || data.attendee?.displayName!==`Guest ${i%400}` || data.nights?.length!==1 || data.nights[0]?.eventSlug!==slug || data.nights[0]?.ticketCount!==1)throw Error(`Unexpected/private data response: ${response.status}`);
  return performance.now()-start;
}
try{
  const deadline=Date.now()+90000;let ready=false;
  while(Date.now()<deadline){try{await request(0);ready=true;break;}catch{if(server.exitCode!==null)throw Error('Local Worker exited; inspect http-worker.log');await new Promise(r=>setTimeout(r,500));}}
  if(!ready)throw Error('Local Worker did not become ready');
  for(const concurrency of [50,100,200,400,800,1600]){
    const start=performance.now();const results=await Promise.allSettled(Array.from({length:concurrency},(_,i)=>request(i)));
    const times=results.filter(r=>r.status==='fulfilled').map(r=>r.value),errors=results.filter(r=>r.status==='rejected');
    const duration=performance.now()-start;
    const result={name:'HTTP My Nights burst',concurrency,distinctAttendees:Math.min(concurrency,400),requests:concurrency,errors:errors.length,firstErrors:errors.slice(0,3).map(r=>String(r.reason)),p50Ms:percentile(times,.5),p95Ms:percentile(times,.95),p99Ms:percentile(times,.99),elapsedMs:Math.round(duration),requestsPerSecond:+(concurrency/(duration/1000)).toFixed(1),meetsTarget:errors.length===0&&percentile(times,.95)<5000};
    metrics.push(result);console.log(JSON.stringify(result));
    if(concurrency<=400&&!result.meetsTarget)throw Error(`Target capacity failed at ${concurrency}`);
    if(errors.length)break;
  }
  // Paced open-loop arrivals, 40 requests/second for 60s: no completion-dependent
  // pacing that would conceal overload. Record scheduler lateness separately.
  const start=performance.now(),pending=[],lateness=[];
  for(let i=0;i<2400;i++){
    const due=start+i*25;const wait=due-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
    lateness.push(Math.max(0,performance.now()-due));pending.push(request(i).then(ms=>({ok:true,ms}),()=>({ok:false,ms:0})));
  }
  const completed=await Promise.all(pending),times=completed.filter(r=>r.ok).map(r=>r.ms);
  const sustained={name:'HTTP 400-attendee paced load',durationSeconds:60,offeredRequestsPerSecond:40,requests:2400,errors:completed.filter(r=>!r.ok).length,p95Ms:percentile(times,.95),p99Ms:percentile(times,.99),p95ArrivalLatenessMs:percentile(lateness,.95)};
  metrics.push(sustained);console.log(JSON.stringify(sustained));
  if(sustained.errors||sustained.p95Ms>3000||sustained.p95ArrivalLatenessMs>250)throw Error('Sustained HTTP load or load-generator timing failed');
  await request(0);metrics.push({name:'post-load recovery',passed:true});
}finally{
  writeFileSync(`${output}/http-measurements.json`,JSON.stringify({revision:process.env.GITHUB_SHA??'local-uncommitted',environment:'built application through loopback HTTP; local workerd and isolated D1',productionQuotasEnforced:false,serverExit,metrics},null,2));
  try{process.kill(-server.pid,'SIGTERM');}catch{/* already stopped */}
  if(server.exitCode===null)await Promise.race([once(server,'exit'),new Promise(r=>setTimeout(r,3000))]);
  log.end();
}
