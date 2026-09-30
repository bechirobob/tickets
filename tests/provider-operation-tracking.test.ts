import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStaffSession, readAdminSession, type StaffRole } from "../lib/admin-session";
import { GET, POST } from "../app/api/admin/orders/route";
import { initiatePaystackRefund } from "../lib/payment-operations";
import { readProviderCases, recordProviderCase } from "../lib/provider-operation-tracking";

const origin = "https://tickets.becoreops.com";
const now = () => new Date().toISOString();
async function staff(role: StaffRole = "finance") {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO staff_accounts (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,'Finance test',?,'test','test',600000,0,'active',?,?,'test',?)`)
    .bind(id,id + "@example.com",role,now(),now(),now()).run();
  const cookie = "bct_staff=" + await createStaffSession(env.DB,{id});
  const session = (await readAdminSession(cookie,env.DB))!;
  return {cookie,session};
}
async function order(provider = "seevplus", verified = true) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO orders (id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at,paid_at,payment_verified_at)
    VALUES (?,?,'tracking-test','general',1,10000,0,10000,'GHS','guest@example.com','233000000000','mobile_money:mtn',?,'paid',?,?,?)`)
    .bind(id,"BCT-" + id,provider,"2026-01-01T00:00:00.000Z",now(),verified ? now() : null).run();
  return id;
}
function input(orderId: string, extra: Record<string, unknown> = {}) {
  return {action:"record_provider_case", operationId:crypto.randomUUID(),orderId,kind:"refund",status:"pending",expectedVersion:0,
    caseReference:"SUPPORT-123",amountMinor:5000,evidenceAt:null,confirmed:true,...extra};
}
function request(cookie: string, body: unknown, requestOrigin = origin) {
  return new Request(origin + "/api/admin/orders", {method:"POST",headers:{cookie,origin:requestOrigin,"content-type":"application/json"},body:JSON.stringify(body)});
}
afterEach(() => vi.restoreAllMocks());

describe("provider-aware manual operation evidence", () => {
  it.each(["paystack","seevplus"])("records %s evidence without financial or ticket changes, with one audit on retries", async provider => {
    const {session} = await staff(); const id = await order(provider); const details = input(id);
    const fetchSpy = vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No provider calls allowed"));
    const before = await env.DB.prepare("SELECT status,total_amount_minor,refunded_amount_minor,refund_status FROM orders WHERE id=?").bind(id).first();
    await recordProviderCase(env.DB,session,details); await recordProviderCase(env.DB,session,details);
    expect(await readProviderCases(env.DB,[id])).toEqual([expect.objectContaining({provider,kind:"refund",status:"pending",version:1,amountMinor:5000})]);
    expect(await env.DB.prepare("SELECT status,total_amount_minor,refunded_amount_minor,refund_status FROM orders WHERE id=?").bind(id).first()).toEqual(before);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM operational_audit_events WHERE target_id=? AND action='payments.provider_case_recorded'").bind(id).first<{n:number}>())?.n).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps settlement unknown until separate checked evidence is recorded and never assumes checkout currency is settlement currency", async () => {
    const {session,cookie} = await staff(); const id = await order();
    const listed = await (await GET(new Request(origin + "/api/admin/orders?event=tracking-test",{headers:{cookie}}))).json() as {orders:Array<{id:string;providerCases:unknown[];paymentVerifiedAt:string;deliveryStatus:string|null}>};
    const item = listed.orders.find(item => item.id === id)!;
    expect(item.paymentVerifiedAt).toBeTruthy(); expect(item.providerCases).toEqual([]); expect(item.deliveryStatus).toBeNull();
    await recordProviderCase(env.DB,session,input(id,{kind:"settlement",amountMinor:null,status:"completed",caseReference:"SETTLE-101",evidenceAt:now()}));
    expect((await readProviderCases(env.DB,[id]))[0]).toMatchObject({kind:"settlement",status:"completed",amountMinor:null});
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM event_settlements WHERE event_slug='tracking-test'").first()).toEqual({n:0});
  });

  it("preserves version history and refuses stale, conflicting or unverified records", async () => {
    const {session} = await staff(); const id = await order(); const first = input(id);
    await recordProviderCase(env.DB,session,first);
    await expect(recordProviderCase(env.DB,session,input(id))).rejects.toMatchObject({status:409});
    await expect(recordProviderCase(env.DB,session,{...first,caseReference:"CHANGED"})).rejects.toMatchObject({status:409});
    await recordProviderCase(env.DB,session,input(id,{expectedVersion:1,status:"completed",evidenceAt:now()}));
    expect((await readProviderCases(env.DB,[id]))[0]).toMatchObject({version:2,status:"completed"});
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_operation_records WHERE order_id=?").bind(id).first()).toEqual({n:2});
    await expect(recordProviderCase(env.DB,session,input(await order("paystack",false)))).rejects.toThrow("verified");
    await expect(recordProviderCase(env.DB,session,input(await order("rsvp")))).rejects.toThrow("verified");
  });

  it("validates evidence, amounts, dates and explicit acknowledgement", async () => {
    const {session} = await staff(); const id = await order();
    for (const extra of [{amountMinor:0},{amountMinor:10001},{amountMinor:1.5},{confirmed:false},{caseReference:"x"},{kind:"anything"},
      {status:"completed",evidenceAt:null},{status:"completed",evidenceAt:"2020-01-01T00:00:00.000Z"},
      {status:"completed",evidenceAt:new Date(Date.now()+86_400_000).toISOString()},
      {kind:"settlement",amountMinor:5000},{expectedVersion:-1},{operationId:"not-an-id"}]) {
      await expect(recordProviderCase(env.DB,session,input(id,extra))).rejects.toThrow();
    }
    expect(await readProviderCases(env.DB,[id])).toEqual([]);
  });

  it("blocks automatic refunds after external case recording, and external cases during an automatic refund", async () => {
    const {session} = await staff(); const id = await order("paystack");
    await recordProviderCase(env.DB,session,input(id));
    const fetchSpy = vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Provider must not run"));
    await expect(initiatePaystackRefund(env.DB,{orderId:id,actor:"test",reason:"Customer request",secret:"test"})).rejects.toThrow("external refund");
    expect(fetchSpy).not.toHaveBeenCalled();
    const pending = await order("paystack");
    await env.DB.prepare(`INSERT INTO payment_refunds (id,order_id,amount_minor,status,reason,requested_by,requested_at,updated_at)
      VALUES (?,?,1000,'pending','test','test',?,?)`).bind(crypto.randomUUID(),pending,now(),now()).run();
    await expect(recordProviderCase(env.DB,session,input(pending))).rejects.toMatchObject({status:409});
    expect(await readProviderCases(env.DB,[pending])).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM operational_audit_events WHERE target_id=?").bind(pending).first()).toEqual({n:0});
  });

  it("allows only one concurrent version and its matching audit event", async () => {
    const {session} = await staff(); const id = await order();
    const results = await Promise.allSettled([recordProviderCase(env.DB,session,input(id)),recordProviderCase(env.DB,session,input(id))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await readProviderCases(env.DB,[id]))[0].version).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM operational_audit_events WHERE target_id=?").bind(id).first()).toEqual({n:1});
  });

  it("closes an unpaid pending refund only with exact checked case details, preserving history and allowing a mocked retry", async () => {
    const {session} = await staff(); const id = await order("paystack");
    await expect(recordProviderCase(env.DB,session,input(id,{status:"closed_unpaid",confirmedNoRefund:true}))).rejects.toMatchObject({status:409});
    await recordProviderCase(env.DB,session,input(id));
    const close = input(id,{status:"closed_unpaid",expectedVersion:1,confirmedNoRefund:true});
    await expect(recordProviderCase(env.DB,session,{...close,confirmedNoRefund:false})).rejects.toThrow("no refund");
    await expect(recordProviderCase(env.DB,session,{...close,caseReference:"DIFFERENT"})).rejects.toMatchObject({status:409});
    await expect(recordProviderCase(env.DB,session,{...close,amountMinor:1000})).rejects.toMatchObject({status:409});
    await recordProviderCase(env.DB,session,close);
    await recordProviderCase(env.DB,session,close);
    expect((await readProviderCases(env.DB,[id]))[0]).toMatchObject({status:"closed_unpaid",version:2,caseReference:"SUPPORT-123",amountMinor:5000});
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_operation_records WHERE order_id=?").bind(id).first()).toEqual({n:2});
    expect(await env.DB.prepare("SELECT status,refunded_amount_minor FROM orders WHERE id=?").bind(id).first()).toEqual({status:"paid",refunded_amount_minor:0});
    const fetchSpy = vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({status:false,message:"Isolated provider rejection"},{status:400}));
    await expect(initiatePaystackRefund(env.DB,{orderId:id,actor:"test",reason:"Isolated retry",secret:"not-a-real-key"})).rejects.toThrow("Isolated provider rejection");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never clears completed refund evidence through an unpaid closure or reopening", async () => {
    const {session} = await staff(); const id = await order("paystack");
    await recordProviderCase(env.DB,session,input(id,{status:"completed",evidenceAt:now()}));
    for (const status of ["pending","closed_unpaid"]) {
      await expect(recordProviderCase(env.DB,session,input(id,{expectedVersion:1,status,confirmedNoRefund:true}))).rejects.toMatchObject({status:409});
    }
    await expect(recordProviderCase(env.DB,session,input(await order(),{kind:"settlement",status:"closed_unpaid",amountMinor:null,confirmedNoRefund:true}))).rejects.toThrow("pending case");
    const fetchSpy = vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No provider call"));
    await expect(initiatePaystackRefund(env.DB,{orderId:id,actor:"test",reason:"Do not repeat",secret:"not-a-real-key"})).rejects.toThrow("external refund");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("enforces finance access and same-origin writes at the route", async () => {
    const id = await order(); const finance = await staff(); const scanner = await staff("gate");
    expect((await GET(new Request(origin + "/api/admin/orders"))).status).toBe(403);
    expect((await GET(new Request(origin + "/api/admin/orders",{headers:{cookie:scanner.cookie}}))).status).toBe(403);
    expect((await POST(request("",input(id)))).status).toBe(403);
    expect((await POST(request(scanner.cookie,input(id)))).status).toBe(403);
    expect((await POST(request(finance.cookie,input(id),"https://other.example"))).status).toBe(403);
    expect((await POST(request(finance.cookie,null))).status).toBe(400);
    const result = await POST(request(finance.cookie,input(id)));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
  });
});
