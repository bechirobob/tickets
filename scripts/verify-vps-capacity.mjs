// Synthetic data, fixed loopback destination, no payment/email credentials.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { SqliteDatabase } from '../runtime/vps/database.mjs';

process.umask(0o077);
const count = 600, host = '127.0.0.1:3220', base = `http://${host}`;
const constrainedServer = process.env.TICKETS_REHEARSAL_SYSTEMD === '1';
if (constrainedServer && process.getuid?.() !== 0) throw Error('Systemd rehearsal requires the existing operator connection.');
const directory = mkdtempSync(path.join(constrainedServer ? '/srv/becore-tickets/temporary' : tmpdir(), 'tickets-vps-capacity-'));
let unit, launch = 0;
const db = new SqliteDatabase(path.join(directory, 'tickets.sqlite'));
const slug = `capacity-${randomUUID()}`, now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString();
const sessions = [], identities = [], passes = [], sockets = [], metrics = [], latencyFailures = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const p95 = values => [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1] ?? 0;
let child, output = '', socketErrors = 0;
async function burst(name, n, action) {
  const times = [], start = performance.now();
  const results = await Promise.all(Array.from({length:n}, async (_, i) => {
    const begun = performance.now(); const value = await action(i); times.push(performance.now()-begun); return value;
  }));
  const result = {name, operations:n, elapsedMs:Math.round(performance.now()-start), p95Ms:Math.round(p95(times))};
  metrics.push(result); console.log(JSON.stringify(result));
  if (result.p95Ms >= 5000) latencyFailures.push(name);
  return results;
}
async function request(route, i, data, cookie) {
  const response = await fetch(base+route, {method:data === undefined ? 'GET':'POST', headers:{origin:base, cookie:cookie ?? `bct_attendee=${sessions[i]}`, 'content-type':'application/json'}, ...(data === undefined ? {}:{body:JSON.stringify(data)}), signal:AbortSignal.timeout(15000)});
  return response;
}
async function start() {
  const values = {PATH:process.env.PATH, NODE_ENV:'production', TICKETS_CONFIG:path.join(directory,'config.json'), TICKETS_STATE:directory, TICKETS_HOST:host, TICKETS_PORT:'3220', TICKETS_ACTIVE:'0'};
  if (constrainedServer) {
    unit = `tickets-capacity-server-${process.pid}-${++launch}`;
    const account = spawnSync('id', ['-u', 'becore-tickets'], {encoding:'utf8'});
    const group = spawnSync('id', ['-g', 'becore-tickets'], {encoding:'utf8'});
    if (account.status !== 0 || group.status !== 0) throw Error('Isolated service account unavailable.');
    const uid=Number(account.stdout.trim()), gid=Number(group.stdout.trim());
    chownSync(directory,uid,gid);
    for(const file of readdirSync(directory)) chownSync(path.join(directory,file),uid,gid);
    child = spawn('systemd-run', ['--quiet','--wait','--collect','--pipe',`--unit=${unit}`,
      '--property=User=becore-tickets','--property=Group=becore-tickets',`--property=WorkingDirectory=${process.cwd()}`,
      '--property=MemoryMax=1G','--property=CPUQuota=200%','--property=TasksMax=128','--property=LimitNOFILE=4096',
      '--property=IPAddressDeny=any','--property=IPAddressAllow=localhost','--property=NoNewPrivileges=true',
      '--property=ProtectSystem=strict',`--property=ReadWritePaths=${directory}`,'--property=ProtectHome=true','--property=PrivateDevices=true',
      '--property=PrivateTmp=true','--property=RuntimeMaxSec=240','--property=TimeoutStopSec=30',
      ...Object.entries(values).map(([key,value])=>`--setenv=${key}=${value}`),
      process.execPath, path.resolve('dist-vps/server.mjs')], {stdio:['ignore','pipe','pipe']});
  } else {
    child = spawn(process.execPath, ['dist-vps/server.mjs'], {env:values, stdio:['ignore','pipe','pipe']});
  }
  for (const stream of [child.stdout,child.stderr]) stream.on('data', data => {output=(output+data).slice(-6000);});
  for(let attempt=0;attempt<80;attempt++) {
    if(child.exitCode!==null) throw Error('Capacity server exited');
    try {if((await fetch(base+'/healthz')).ok)return;} catch { /* startup */ }
    await delay(250);
  }
  throw Error('Capacity server startup timed out');
}
async function stop() {
  for (const socket of sockets) socket?.terminate();
  if(child && child.exitCode===null) {
    const exited=once(child,'exit');
    if (constrainedServer) {
      const usage=spawnSync('systemctl',['show',unit,'-p','MemoryPeak','-p','CPUUsageNSec'],{encoding:'utf8'});
      console.log(JSON.stringify({name:'server-resource-usage',limits:{memoryBytes:1073741824,cpuPercent:200},usage:usage.stdout.trim()}));
      spawnSync('systemctl',['stop',unit],{timeout:35000});
    } else child.kill('SIGTERM');
    const result=await Promise.race([exited,delay(25000).then(()=>null)]);
    if(!result) {child.kill('SIGKILL');throw Error('Graceful shutdown timed out');}
    assert.equal(result[0],0);
  }
}
async function connect(i, receive = () => {}) {
  const socket = new WebSocket(`ws://${host}/api/room/socket?event=${slug}`,{headers:{origin:`https://${host}`,cookie:`bct_attendee=${sessions[i]}`}});
  sockets[i]=socket;
  socket.on('error',()=>{socketErrors++;});
  socket.on('message',raw=>{const value=JSON.parse(String(raw)); if(value.type==='error')socketErrors++; receive(value);});
  const [raw]=await Promise.race([once(socket,'message'),delay(10000).then(()=>{throw Error('Room snapshot timeout');})]);
  const snapshot=JSON.parse(String(raw));assert.equal(snapshot.type,'snapshot');return snapshot;
}
try {
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join('drizzle',file),'utf8'));
  await db.prepare("INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES (?,?,?,'Synthetic capacity','Test','Accra',?,?,'Late night',10000,600,'on_sale','https://example.com/test.webp','Isolated fixture','published',?,?,?)").bind(slug,slug,slug,now,future,now,now,now).run();
  for(let i=0;i<count;i++) {
    const id=randomUUID(), token=randomBytes(32).toString('base64url');sessions.push(token);identities.push(id);
    await db.batch([
      db.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES (?,?,'Synthetic guest',?,'active',?,?)").bind(id,`${id}@example.com`,now,now,now),
      db.prepare('INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').bind(id,id,hash(token),future,now,now),
      db.prepare("INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES (?,?,?,'general',1,10000,0,10000,'GHS',?,'233000000000','mobile_money:mtn','paid',?,?)").bind(id,`BCT-${id}`,slug,`${id}@example.com`,now,now),
      db.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',1,?,'issued',?)").bind(id,id,slug,id,now),
      db.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'fixture','active',?)").bind(id,id,now),
    ]);
  }
  writeFileSync(path.join(directory,'config.json'),JSON.stringify({ENVIRONMENT:'test',STAFF_LOGIN_DECOY_SECRET:'isolated-capacity-test-no-production-access'}));
  await start();
  await burst('wallet-600-distinct-guests',count,async i=>{const response=await request('/api/customer/tickets',i,{});assert.equal(response.status,200);const body=await response.json();assert.equal(body.orders.length,1);assert.equal(body.orders[0].orderId,identities[i]);passes[i]=body.orders[0].tickets[0].qrPayload;});
  assert.equal(new Set(passes).size,count);
  for(const n of [100,400,600])await burst(`my-nights-${n}`,n,async i=>{const response=await request('/api/customer/my-nights',i);assert.equal(response.status,200);const body=await response.json();assert.equal(body.nights[0].eventSlug,slug);});
  const staff=randomUUID(), staffToken=randomBytes(32).toString('base64url');
  await db.prepare("INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,failed_login_count,password_changed_at,created_at,created_by,updated_at) VALUES (?,?,'Synthetic gate','owner','test','test',1,0,'active',0,?,?,'test',?)").bind(staff,`${staff}@example.com`,now,now,now).run();
  await db.prepare('INSERT INTO staff_sessions(id,account_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').bind(staff,staff,createHash('sha256').update(staffToken).digest('base64url'),future,now,now).run();
  const scanned=await burst('gate-1200-duplicate-races',count*2,async i=>{const response=await request('/api/admin/check-in',0,{code:passes[i%count],eventSlug:slug,gate:`Gate ${i%4}`},`bct_staff=${staffToken}`);await response.text();assert.ok([200,409].includes(response.status),`scan ${response.status}`);return response.status;});
  assert.equal(scanned.filter(s=>s===200).length,count);assert.equal(scanned.filter(s=>s===409).length,count);
  const received=Array.from({length:count},()=>new Set()), sent=new Map(), delivery=[];
  const receive=i=>value=>{if(value.type==='message' && sent.has(value.message.content)){received[i].add(value.message.content);delivery.push(performance.now()-sent.get(value.message.content));}};
  await burst('room-600-simultaneous-joins',count,i=>connect(i,receive(i)));
  for(let n=0;n<120;n++){const content=`capacity-message-${n}`;sent.set(content,performance.now());sockets[n%count].send(JSON.stringify({type:'message',content}));await delay(500);}
  const deadline=Date.now()+30000;
  while(received.some(set=>set.size<120)&&Date.now()<deadline)await delay(50);
  assert.equal(received.reduce((sum,set)=>sum+set.size,0),72000);assert.equal(socketErrors,0);assert.ok(p95(delivery)<5000);
  metrics.push({name:'room-600-guests-60-seconds',messages:120,deliveries:72000,p95Ms:Math.round(p95(delivery)),errors:socketErrors});console.log(JSON.stringify(metrics.at(-1)));
  const revoked=count-1;let leaked=false;sockets[revoked].on('message',data=>{if(String(data).includes('after-revocation'))leaked=true;});
  const closed=once(sockets[revoked],'close');await db.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(now,identities[revoked]).run();
  sockets[0].send(JSON.stringify({type:'message',content:'after-revocation'}));
  assert.equal((await Promise.race([closed,delay(10000).then(()=>{throw Error('Revocation timeout');})]))[0],4003);assert.equal(leaked,false);
  await stop();await start();
  await burst('room-599-reconnect-after-restart',count-1,async i=>{const snapshot=await connect(i);assert.ok(snapshot.messages.some(m=>m.content==='after-revocation'));});
  await burst('my-nights-after-restart',count-1,async i=>{const response=await request('/api/customer/my-nights',i);assert.equal(response.status,200);await response.arrayBuffer();});
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM gate_checkin_events WHERE event_slug=?').bind(slug).first()).n,count);
  assert.deepEqual(latencyFailures, [], 'Bursts exceeding the unchanged 5-second p95 target');
  console.log(JSON.stringify({result:'passed',guests:count,providers:'none; synthetic paid-ticket fixtures',productionDataTouched:false,metrics}));
} catch(error) {console.error(output);throw error;}
finally {await stop();db.close();rmSync(directory,{recursive:true,force:true});}
