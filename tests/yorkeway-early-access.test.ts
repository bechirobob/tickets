import { adminCookieHeader, createStaffSession } from '../lib/admin-session';
import { retryFailedDeliveries } from '../lib/email-delivery';
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as signup } from '../app/api/yorkeway/route';
import { POST as confirm } from '../app/api/yorkeway/confirm/route';
import { POST as withdraw } from '../app/api/yorkeway/withdraw/route';
import { GET as audience } from '../app/api/admin/yorkeway-audience/route';
import { captureYorkewaySignup, confirmYorkewaySignup, parseYorkewaySignup, withdrawYorkewaySignup, yorkewayConfirmationEmail } from '../lib/yorkeway-early-access';

const origin='https://tickets.becoreops.com';
const email=()=>`${crypto.randomUUID()}@example.com`;
const request=(path:string,body:unknown,source=origin)=>new Request(`${origin}${path}`,{method:'POST',headers:{origin:source,'content-type':'application/json'},body:JSON.stringify(body)});
async function saved(address:string) { return env.DB.prepare('SELECT * FROM yorkeway_early_access WHERE email=?').bind(address).first<Record<string,unknown>>(); }
async function links(address:string) {
  const row=await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE recipient=? AND kind='yorkeway_confirmation' ORDER BY created_at DESC LIMIT 1").bind(address).first<{payload:string}>();
  const payload=JSON.parse(row!.payload) as {text:string};
  return {confirm:payload.text.match(/\/confirm#([\w-]+)/)![1],withdraw:payload.text.match(/\/unsubscribe#([\w-]+)/)![1]};
}
beforeEach(()=>{ vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'synthetic-message'}))); });
afterEach(()=>vi.unstubAllGlobals());

describe('Yorke Way isolated double opt-in',()=>{
  it('requires explicit consent and bounded input',()=>{
    expect(parseYorkewaySignup({name:'Guest',email:'a@example.com',consent:false})).toBeNull();
    expect(parseYorkewaySignup({name:'x'.repeat(101),email:'a@example.com',consent:true})).toBeNull();
    expect(parseYorkewaySignup({name:'Guest',email:'bad',consent:true})).toBeNull();
    expect(parseYorkewaySignup({name:' Guest ',email:' A@EXAMPLE.COM ',consent:true})).toEqual({name:'Guest',email:'a@example.com'});
  });
  it('stores pending only; confirmation email has list-only links',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'});
    expect((await saved(address))?.status).toBe('pending');
    const tokens=await links(address); expect(tokens.confirm).not.toBe(tokens.withdraw);
    expect(await env.DB.prepare('SELECT 1 FROM attendee_profiles WHERE normalized_email=?').bind(address).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM event_registrations WHERE normalized_email=?').bind(address).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM platform_announcement_subscriptions WHERE email=?').bind(address).first()).toBeNull();
    expect(await confirmYorkewaySignup(env.DB,tokens.confirm)).toBe(true);
    expect((await saved(address))?.status).toBe('subscribed');
    expect(await confirmYorkewaySignup(env.DB,tokens.confirm)).toBe(false);
  });
  it('duplicate submission sends once and does not alter name or consent',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Original'});
    const before=await saved(address); await captureYorkewaySignup(env.DB,{email:address,name:'Changed'});
    expect(await saved(address)).toEqual(before);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=? AND kind='yorkeway_confirmation'").bind(address).first<{n:number}>())?.n).toBe(1);
  });
  it('withdrawal blocks old confirmation, replay and duplicate resubscription',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const tokens=await links(address);
    await withdrawYorkewaySignup(env.DB,tokens.withdraw);
    expect(await confirmYorkewaySignup(env.DB,tokens.confirm)).toBe(false);
    const before=await saved(address); await withdrawYorkewaySignup(env.DB,tokens.withdraw);
    await captureYorkewaySignup(env.DB,{email:address,name:'Other'});
    expect(await saved(address)).toEqual(before);
  });
  it('withdrawing a fresh request after a previous withdrawal invalidates its proof',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const first=await links(address);
    await withdrawYorkewaySignup(env.DB,first.withdraw);
    await env.DB.prepare("UPDATE yorkeway_signup_grants SET created_at='2000-01-01T00:00:00.000Z' WHERE email=?").bind(address).run();
    await env.DB.prepare("UPDATE delivery_events SET created_at='2000-01-01T00:00:00.000Z' WHERE recipient=?").bind(address).run();
    await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const fresh=await links(address);
    expect(fresh.confirm).not.toBe(first.confirm);
    await withdrawYorkewaySignup(env.DB,fresh.withdraw);
    expect(await confirmYorkewaySignup(env.DB,fresh.confirm)).toBe(false);
    const before=await saved(address); await withdrawYorkewaySignup(env.DB,fresh.withdraw);
    expect(await saved(address)).toEqual(before);
  });
  it('honours withdrawal from any email in the confirmed consent cycle',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const first=await links(address);
    await env.DB.prepare("UPDATE yorkeway_signup_grants SET created_at='2000-01-01T00:00:00.000Z' WHERE email=?").bind(address).run();
    await env.DB.prepare("UPDATE delivery_events SET created_at='2000-01-01T00:00:00.000Z' WHERE recipient=?").bind(address).run();
    await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const second=await links(address);
    expect(await confirmYorkewaySignup(env.DB,first.confirm)).toBe(true);
    await withdrawYorkewaySignup(env.DB,second.withdraw);
    expect((await saved(address))?.status).toBe('withdrawn');
    expect(await confirmYorkewaySignup(env.DB,second.confirm)).toBe(false);
  });
  it('supports unsubscribe after confirmation without affecting other lists',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const tokens=await links(address);
    await confirmYorkewaySignup(env.DB,tokens.confirm); await withdrawYorkewaySignup(env.DB,tokens.withdraw);
    expect((await saved(address))?.status).toBe('withdrawn');
    expect(await confirmYorkewaySignup(env.DB,tokens.confirm)).toBe(false);
  });
  it('expired tokens cannot activate',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const tokens=await links(address);
    await env.DB.prepare("UPDATE yorkeway_signup_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE email=?").bind(address).run();
    expect(await confirmYorkewaySignup(env.DB,tokens.confirm)).toBe(false);
  });
  it('respects provider-wide suppression without sending',async()=>{
    const address=email(); await env.DB.prepare('INSERT INTO marketing_contacts(email,provider_id,unsubscribed,updated_at) VALUES(?,?,1,?)').bind(address,crypto.randomUUID(),new Date().toISOString()).run();
    await captureYorkewaySignup(env.DB,{email:address,name:'Guest'});
    expect(await env.DB.prepare("SELECT 1 FROM delivery_events WHERE recipient=? AND kind='yorkeway_confirmation'").bind(address).first()).toBeNull();
  });
  it('does not send to known complaints or activate proof after a hard bounce',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const tokens=await links(address);
    await env.DB.prepare("UPDATE delivery_events SET status='bounced' WHERE recipient=?").bind(address).run();
    expect(await confirmYorkewaySignup(env.DB,tokens.confirm)).toBe(false);
    await env.DB.prepare("UPDATE yorkeway_signup_grants SET created_at='2000-01-01T00:00:00.000Z' WHERE email=?").bind(address).run();
    await captureYorkewaySignup(env.DB,{email:address,name:'Guest'});
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=?").bind(address).first<{n:number}>())?.n).toBe(1);
  });
  it('rejects cross-origin writes and oversized input',async()=>{
    expect((await signup(request('/api/yorkeway',{name:'Guest',email:email(),consent:true},'https://evil.example'))).status).toBe(403);
    expect((await signup(request('/api/yorkeway',{name:'x'.repeat(3000),email:email(),consent:true}))).status).toBe(413);
    expect((await confirm(request('/api/yorkeway/confirm',{token:'x'},'https://evil.example'))).status).toBe(403);
    expect((await withdraw(request('/api/yorkeway/withdraw',{token:'x'},'https://evil.example'))).status).toBe(403);
  });
  it('returns generic signup response without tokens or status',async()=>{
    const response=await signup(request('/api/yorkeway',{name:'Guest',email:email(),consent:true}));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({received:true});
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('keeps the contact list private',async()=>{
    const response=await audience(new Request(`${origin}/api/admin/yorkeway-audience`));
    expect(response.status).toBe(403); expect(response.headers.get('cache-control')).toContain('private');
  });
  it('deduplicates simultaneous submissions atomically',async()=>{
    const address=email(); await Promise.all(Array.from({length:5},()=>captureYorkewaySignup(env.DB,{email:address,name:'Guest'})));
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM yorkeway_signup_grants WHERE email=?').bind(address).first<{n:number}>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=?").bind(address).first<{n:number}>())?.n).toBe(1);
  });
  it('rejects other staff roles and a password-change-required owner',async()=>{
    for (const [role,change] of [['organizer',0],['support',0],['owner',1]] as const) {
      const id=crypto.randomUUID(),stamp=new Date().toISOString();
      await env.DB.prepare(`INSERT INTO staff_accounts (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password, status, password_changed_at, created_at, created_by, updated_at)
        VALUES (?, ?, 'Staff', ?, 'test', 'test', 1, ?, 'active', ?, ?, 'test', ?)`)
        .bind(id,email(),role,change,stamp,stamp,stamp).run();
      const cookie=adminCookieHeader(await createStaffSession(env.DB,{id})).split(';')[0];
      expect((await audience(new Request(`${origin}/api/admin/yorkeway-audience`,{headers:{cookie}}))).status).toBe(403);
    }
  });
  it('shows the owner only confirmed unsuppressed contacts and separate counts',async()=>{
    const address=email(),pending=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Confirmed guest'}); const token=await links(address);
    await confirmYorkewaySignup(env.DB,token.confirm); await captureYorkewaySignup(env.DB,{email:pending,name:'Pending guest'});
    const id=crypto.randomUUID(),stamp=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO staff_accounts (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
      VALUES (?,?,'Owner','owner','test','test',1,0,'active',?,?,'test',?)`).bind(id,email(),stamp,stamp,stamp).run();
    const cookie=adminCookieHeader(await createStaffSession(env.DB,{id})).split(';')[0];
    const response=await audience(new Request(`${origin}/api/admin/yorkeway-audience`,{headers:{cookie}}));
    expect(response.status).toBe(200); const body=await response.json() as {contacts:{email:string}[];summary:{pending:number;subscribed:number}};
    expect(body.contacts.some(x=>x.email===pending)).toBe(false); expect(body.summary.pending).toBeGreaterThan(0); expect(body.summary.subscribed).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('token_hash');
  });
  it('suppresses a queued confirmation after withdrawal without a provider call',async()=>{
    const address=email(); await captureYorkewaySignup(env.DB,{email:address,name:'Guest'}); const tokens=await links(address);
    await withdrawYorkewaySignup(env.DB,tokens.withdraw);
    await env.DB.prepare("UPDATE delivery_events SET status='failed',provider_id=NULL,attempt_count=0,next_attempt_at='2000-01-01T00:00:00.000Z' WHERE recipient=?").bind(address).run();
    vi.mocked(fetch).mockClear(); await retryFailedDeliveries(env);
    expect(fetch).not.toHaveBeenCalled();
    expect((await env.DB.prepare('SELECT status FROM delivery_events WHERE recipient=?').bind(address).first<{status:string}>())?.status).toBe('suppressed');
  });
  it('uses the established email shell without account or ticket links',()=>{
    const message=yorkewayConfirmationEmail('sample-confirmation','sample-withdrawal');
    expect(message.html).toContain('bgcolor="#301d2c"'); expect(message.html).toContain('bgcolor="#f8f4ec"');
    expect(message.html).toContain('bgcolor="#d6f075"'); expect(message.text).toContain('not an event RSVP');
    expect(message.html).not.toContain('/my-nights');
  });
});
