import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureOrganizerAccess, claimOrganizerInvitation, inspectOrganizerInvitation, organizerAccessStatus, processPendingOrganizerAccess, invitationEmail } from "../lib/organizer-invitations";
import { retryFailedDeliveries } from "../lib/email-delivery";
import { adminCookieHeader, authenticateStaff, createStaffSession, readAdminSession } from "../lib/admin-session";
import { PASSWORD_ITERATIONS, bytesToBase64Url } from "../lib/staff-password-policy";
import { POST as activate } from "../app/api/organizer/activate/route";
import { POST as invite, GET as status } from "../app/api/admin/organizer-invitations/route";
import { PATCH as approve } from "../app/api/admin/submissions/route";

const origin = "https://tickets.becoreops.com";
const payload = { password:"NewHostPassword9",passwordProof:bytesToBase64Url(new Uint8Array(32).fill(12)),passwordSalt:"AAECAwQFBgcICQoLDA0ODw",passwordIterations:PASSWORD_ITERATIONS };
async function submission(state = "approved",email = `${crypto.randomUUID()}@example.com`) {
  const id = crypto.randomUUID();const now = new Date().toISOString();const slug = `invite-${id}`;
  await env.DB.prepare(`INSERT INTO party_submissions(id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,event_slug,created_at,updated_at)
    VALUES (?,'The hosts','Test Host',?,'233000000000','Test party','Our party concept','Test Venue','Accra','2027-01-01T18:00:00Z','2027-01-02T00:00:00Z','Late night','DJ',100,10000,'18+',?,?,?,?)`)
    .bind(id,email,state,slug,now,now).run();
  return { id,email,slug };
}
async function invited() {
  const s = await submission();
  await ensureOrganizerAccess(env.DB,{submissionId:s.id},"test");
  return { ...s,...await storedInvite(s.email) };
}
async function storedInvite(email: string) {
  const row = await env.DB.prepare(`SELECT i.id AS inviteId,i.account_id AS accountId,d.payload_json AS payload FROM organizer_invitations i JOIN delivery_events d ON d.recovery_grant_id=i.id WHERE i.account_email=?`).bind(email).first<{inviteId:string;accountId:string;payload:string}>();
  const mail = JSON.parse(row!.payload);
  const token = mail.text.match(/#token=([A-Za-z0-9_-]{43})/u)[1] as string;
  return { ...row!,token,mail };
}
function req(path: string,body?:object,cookie?:string) {
  return new Request(`${origin}${path}`,{method:body ? "POST":"GET",headers:{origin,"content-type":"application/json",...(cookie ? {cookie}:{})},...(body ? {body:JSON.stringify(body)}:{})});
}
beforeEach(()=>vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json({id:crypto.randomUUID()})));
afterEach(()=>vi.restoreAllMocks());

describe("organiser approval invitations",()=>{
  it("approval creates the organiser, links their event, and sends the branded email",async()=>{
    const owner = await invited();
    await env.DB.prepare("UPDATE staff_accounts SET role='owner',must_change_password=0 WHERE id=?").bind(owner.accountId).run();
    const cookie = adminCookieHeader(await createStaffSession(env.DB,{id:owner.accountId}));
    const s=await submission("in_review");
    const response=await approve(new Request(`${origin}/api/admin/submissions`,{method:"PATCH",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify({id:s.id,action:"approve",curationNote:"A carefully selected event for the Accra community.",tagline:`A fresh invitation ${s.id.slice(0,8)}`})}));
    expect(response.status).toBe(200);
    expect((await response.json() as {accessNotice:string}).accessNotice).toContain("Password setup");
    const item=await storedInvite(s.email);
    expect(item.mail.html).toContain("/brand/becore-ticket.png");
    expect(item.mail.text).toContain("48 hours");
    expect(await env.DB.prepare("SELECT 1 FROM staff_event_assignments WHERE account_id=? AND event_slug=?").bind(item.accountId,s.slug).first()).not.toBeNull();
    expect((await organizerAccessStatus(env.DB,{submissionId:s.id})).deliveryStatus).toBe("sent");
    const call=vi.mocked(fetch).mock.calls.find(([,init])=>String(init?.body).includes(s.email));
    expect(JSON.parse(String(call?.[1]?.body)).to).toEqual([s.email]);
  });
  it("commits an unusable initial password and an outbox; repeated approvals do not duplicate the invite",async()=>{
    const item=await invited();
    expect((await authenticateStaff(env.DB,item.email,payload.passwordProof)).account).toBeNull();
    await ensureOrganizerAccess(env.DB,{submissionId:item.id},"test");
    expect((await storedInvite(item.email)).inviteId).toBe(item.inviteId);
    expect(await inspectOrganizerInvitation(env.DB,item.token)).not.toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("a later approval replaces an expired setup link without requiring manual resend",async()=>{
    const item=await invited();
    await env.DB.prepare("UPDATE organizer_invitations SET expires_at='2000-01-01' WHERE account_id=?").bind(item.accountId).run();
    const next=await submission("approved",item.email);
    await ensureOrganizerAccess(env.DB,{submissionId:next.id},"test");
    const fresh=await storedInvite(item.email);
    expect(fresh.inviteId).not.toBe(item.inviteId);
    expect(await inspectOrganizerInvitation(env.DB,fresh.token)).not.toBeNull();
    expect(await inspectOrganizerInvitation(env.DB,item.token)).toBeNull();
  });
  it("claims once under concurrency, revokes old sessions, and preserves unrelated access",async()=>{
    const item=await invited();const other=await invited();
    const oldCookie=adminCookieHeader(await createStaffSession(env.DB,{id:item.accountId}));
    const otherCookie=adminCookieHeader(await createStaffSession(env.DB,{id:other.accountId}));
    const results=await Promise.allSettled([claimOrganizerInvitation(env.DB,item.token,payload),claimOrganizerInvitation(env.DB,item.token,payload)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(await inspectOrganizerInvitation(env.DB,item.token)).toBeNull();
    expect((await authenticateStaff(env.DB,item.email,payload.passwordProof)).account?.id).toBe(item.accountId);
    expect(await readAdminSession(oldCookie,env.DB)).toBeNull();
    expect(await readAdminSession(otherCookie,env.DB)).not.toBeNull();
    expect((await organizerAccessStatus(env.DB,{accountId:item.accountId})).state).toBe("activated");
    const before=await env.DB.prepare("SELECT password_hash FROM staff_accounts WHERE id=?").bind(item.accountId).first();
    await ensureOrganizerAccess(env.DB,{submissionId:item.id},"test",true);
    expect(await env.DB.prepare("SELECT password_hash FROM staff_accounts WHERE id=?").bind(item.accountId).first()).toEqual(before);
  });
  it("resend rotates the link, enforces cooldown and suppresses old queued emails",async()=>{
    const item=await invited();
    await expect(ensureOrganizerAccess(env.DB,{accountId:item.accountId},"test",true)).rejects.toThrow("Wait a minute");
    await env.DB.prepare("UPDATE organizer_invitations SET created_at=? WHERE account_id=?").bind(new Date(Date.now()-120000).toISOString(),item.accountId).run();
    await ensureOrganizerAccess(env.DB,{accountId:item.accountId},"test",true);
    expect(await inspectOrganizerInvitation(env.DB,item.token)).toBeNull();
    await retryFailedDeliveries(env,20,"invitations");
    expect(vi.mocked(fetch).mock.calls.filter(([,init])=>String(init?.body).includes(item.email))).toHaveLength(1);
    expect((await env.DB.prepare("SELECT status,payload_json FROM delivery_events WHERE recovery_grant_id=?").bind(item.inviteId).first())).toEqual({status:"suppressed",payload_json:null});
  });
  it.each(["disabled","role","email","password","expired"])("invalidates invites when %s changes",async(change)=>{
    const item=await invited();
    const updates:Record<string,string>={disabled:"UPDATE staff_accounts SET status='disabled' WHERE id=?",role:"UPDATE staff_accounts SET role='owner' WHERE id=?",email:"UPDATE staff_accounts SET normalized_email='other@example.com' WHERE id=?",password:"UPDATE staff_accounts SET password_hash='changed' WHERE id=?",expired:"UPDATE organizer_invitations SET expires_at='2000-01-01' WHERE account_id=?"};
    await env.DB.prepare(updates[change]).bind(item.accountId).run();
    await expect(claimOrganizerInvitation(env.DB,item.token,payload)).rejects.toThrow("invalid, expired");
    await retryFailedDeliveries(env,20,"invitations");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("never promotes or enables an existing account, or invites an unapproved contact",async()=>{
    const item=await invited();
    await env.DB.prepare("UPDATE staff_accounts SET role='finance' WHERE id=?").bind(item.accountId).run();
    const second=await submission("approved",item.email);
    await expect(ensureOrganizerAccess(env.DB,{submissionId:second.id},"test")).rejects.toThrow("another staff role");
    const unapproved=await submission("in_review");
    await expect(ensureOrganizerAccess(env.DB,{submissionId:unapproved.id},"test")).rejects.toThrow("Approve this submission");
  });
  it("recovers interrupted approval processing without inviting historical submissions",async()=>{
    const pending=await submission();const historic=await submission();
    await env.DB.prepare("UPDATE party_submissions SET organizer_access_pending=1 WHERE id=?").bind(pending.id).run();
    await processPendingOrganizerAccess(env.DB);
    expect((await organizerAccessStatus(env.DB,{submissionId:pending.id})).state).toBe("invited");
    expect((await organizerAccessStatus(env.DB,{submissionId:historic.id})).state).toBe("not_invited");
  });
  it("keeps provider failure queued for retry without losing approval or the invite",async()=>{
    const item=await invited();
    vi.mocked(fetch).mockImplementation(async (_url,init)=>String(init?.body).includes(item.email)
      ? Response.json({message:"Unavailable"},{status:503}) : Response.json({id:crypto.randomUUID()}));
    await retryFailedDeliveries(env,20,"invitations");
    expect((await organizerAccessStatus(env.DB,{accountId:item.accountId})).deliveryStatus).toBe("failed");
    vi.mocked(fetch).mockImplementation(async()=>Response.json({id:crypto.randomUUID()}));
    await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2000-01-01' WHERE recovery_grant_id=?").bind(item.inviteId).run();
    await retryFailedDeliveries(env,20,"invitations");
    expect((await organizerAccessStatus(env.DB,{accountId:item.accountId})).deliveryStatus).toBe("sent");
  });
  it("protects invitation endpoints and uses POST-only private activation",async()=>{
    const item=await invited();
    expect((await invite(req("/api/admin/organizer-invitations",{accountId:item.accountId}))).status).toBe(403);
    expect((await status(req(`/api/admin/organizer-invitations?accountId=${item.accountId}`))).status).toBe(403);
    const cookie=adminCookieHeader(await createStaffSession(env.DB,{id:item.accountId}));
    expect((await invite(req("/api/admin/organizer-invitations",{accountId:item.accountId},cookie))).status).toBe(403);
    const cross= new Request(`${origin}/api/organizer/activate`,{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({action:"claim",token:item.token,...payload})});
    expect((await activate(cross)).status).toBe(403);
    const inspected=await activate(req("/api/organizer/activate",{action:"inspect",token:item.token}));
    expect(inspected.headers.get("cache-control")).toBe("no-store");
    expect(await inspected.json()).toMatchObject({valid:true});
    const changed=await activate(req("/api/organizer/activate",{action:"claim",token:item.token,...payload}));
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({changed:true});
  });
  it("escapes host-supplied names in the branded message",()=>{
    expect(invitationEmail('<img src=x onerror="alert(1)">',origin).html).toContain("&lt;img");
  });
});
