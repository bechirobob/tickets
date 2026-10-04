import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { beginGateAccess, clearGateManifests, GATE_MANIFEST_KEY, readGateManifest, saveGateManifest, type GateAccess, type GateManifest } from '../lib/scanner-manifest';
import { GATE_QUEUE_KEY, GATE_REVIEW_KEY } from '../lib/scanner-sync';
import { GET as manifest } from '../app/api/admin/check-in/route';
import { createStaffSession, readAdminSession } from '../lib/admin-session';

const now = Date.parse('2026-10-03T23:00:00.000Z');
const access: GateAccess = {accountId:'staff-a',sessionId:'session-a',expiresAt:(now+3600000)/1000};
const list: GateManifest = {eventSlug:'night-a',generatedAt:new Date(now).toISOString(),access,tickets:[]};
function fixture() {
  const records = new Map([[GATE_QUEUE_KEY,'pending scan evidence'],[GATE_REVIEW_KEY,'pending review evidence']]);
  const storage = {getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);},removeItem:(key:string)=>{records.delete(key);}};
  beginGateAccess(storage,access);
  expect(saveGateManifest(storage,access,list,now)).toBe(true);
  return storage;
}
describe('offline scanner access boundary',()=>{
  it('accepts only the issuing staff account, session and event before expiry',()=>{
    const s=fixture();
    expect(readGateManifest(s,access,'night-a',now)).toEqual(list);
    expect(readGateManifest(s,{...access,accountId:'staff-b'},'night-a',now)).toBeNull();
    expect(readGateManifest(s,{...access,sessionId:'session-b'},'night-a',now)).toBeNull();
    expect(readGateManifest(s,access,'night-b',now)).toBeNull();
    expect(readGateManifest(s,access,'night-a',access.expiresAt*1000)).toBeNull();
  });
  it('rejects unscoped, stale, future and malformed manifests',()=>{
    const s=fixture();
    for(const invalid of [{...list,access:undefined},{...list,generatedAt:'2024-10-03T00:00:00Z'},{...list,generatedAt:new Date(now+120000).toISOString()},{...list,tickets:null},{...list,tickets:[null]},{...list,tickets:[{ticketId:'id',tokenHash:'hash',ticketType:'general',attendeeName:'Guest',status:'voided'}]}]) {
      s.setItem(GATE_MANIFEST_KEY,JSON.stringify({'night-a':invalid}));
      expect(readGateManifest(s,access,'night-a',now)).toBeNull();
    }
    s.setItem(GATE_MANIFEST_KEY,'not JSON');
    expect(readGateManifest(s,access,'night-a',now)).toBeNull();
  });
  it('logout or an access denial removes lists without erasing queued scans or reviews',()=>{
    const s=fixture();s.setItem('bct:gate-manifests:v1','legacy unscoped list');
    clearGateManifests(s);
    expect(readGateManifest(s,access,'night-a',now)).toBeNull();
    expect(s.getItem('bct:gate-manifests:v1')).toBeNull();
    expect(s.getItem(GATE_QUEUE_KEY)).toBe('pending scan evidence');
    expect(s.getItem(GATE_REVIEW_KEY)).toBe('pending review evidence');
    expect(saveGateManifest(s,access,list,now)).toBe(false);
  });
  it('a new staff session replaces old lists and rejects old in-flight responses',()=>{
    const s=fixture(), next={...access,accountId:'staff-b',sessionId:'session-b'};
    beginGateAccess(s,next);
    expect(readGateManifest(s,access,'night-a',now)).toBeNull();
    expect(saveGateManifest(s,access,list,now)).toBe(false);
    expect(saveGateManifest(s,next,{...list,access:next},now)).toBe(true);
    expect(readGateManifest(s,next,'night-a',now)).toMatchObject({access:next});
    clearGateManifests(s,access);
    expect(readGateManifest(s,next,'night-a',now)).toMatchObject({access:next});
    clearGateManifests(s,next);
    expect(readGateManifest(s,next,'night-a',now)).toBeNull();
    expect(s.getItem(GATE_QUEUE_KEY)).toBe('pending scan evidence');
    expect(s.getItem(GATE_REVIEW_KEY)).toBe('pending review evidence');
  });
});

it('scopes a downloaded manifest to the server-verified staff session',async()=>{
  const id=crypto.randomUUID(), stamp=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,'Gate fixture','gate','test','test',600000,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,stamp,stamp,stamp).run();
  await env.DB.prepare("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,'after-dark-osu','test',?)").bind(id,stamp).run();
  const token=await createStaffSession(env.DB,{id}),cookie=`bct_staff=${token}`,session=(await readAdminSession(cookie,env.DB))!;
  const response=await manifest(new Request('https://tickets.becoreops.com/api/admin/check-in?eventSlug=after-dark-osu&manifest=1',{headers:{cookie}}));
  expect(response.status).toBe(200);
  const data=await response.json();
  expect(data).toMatchObject({access:{accountId:id,sessionId:session.sessionId,expiresAt:session.expiresAt}});
  expect(JSON.stringify(data)).not.toContain(token);
});
