import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initiatePaystackRefund as legacyRefund } from './fixtures/legacy-paystack-refund';

afterEach(() => vi.restoreAllMocks());
async function seed(status: 'pending' | 'completed' = 'pending') {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at,paid_at,payment_verified_at) VALUES(?,?,'rollback-fixture','general',1,10000,0,10000,'GHS','fixture@example.com','233000000000','card','paystack','paid',?,?,?)`).bind(id,`BCT-${id}`,now,now,now).run();
  await env.DB.prepare(`INSERT INTO provider_operation_records(id,order_id,provider,kind,status,version,case_reference,amount_minor,currency,evidence_at,recorded_by,recorded_at) VALUES(?,?,'paystack','refund',?,1,'PROVIDER-CASE',5000,'GHS',?,'fixture',?)`).bind(crypto.randomUUID(),id,status,status === 'completed' ? now : null,now).run();
  return id;
}

describe('binary rollback preserves refund reservation safety', () => {
  it.each(['pending','completed'] as const)('blocks the exact old live refund code before provider traffic for %s evidence', async status => {
    const id = await seed(status), fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real provider calls'));
    await expect(legacyRefund(env.DB,{orderId:id,actor:'fixture',reason:'Isolated rollback regression',secret:'test-only'})).rejects.toThrow('external refund case');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM payment_refunds WHERE order_id=?').bind(id).first()).toEqual({count:0});
    expect(await env.DB.prepare('SELECT status,refunded_amount_minor FROM orders WHERE id=?').bind(id).first()).toEqual({status:'paid',refunded_amount_minor:0});
  });
  it('allows the existing mass-refund preflight failure audit row while blocking reservations', async () => {
    const id = await seed(), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO payment_refunds(id,order_id,amount_minor,status,reason,requested_by,requested_at,updated_at) VALUES(?,?,10000,'failed','External case needs review','fixture',?,?)`).bind(crypto.randomUUID(),id,now,now).run();
    expect(await env.DB.prepare('SELECT status FROM payment_refunds WHERE order_id=?').bind(id).first()).toEqual({status:'failed'});
  });
  it('permits a checked closed-unpaid case to use the old reservation path with a mocked provider only', async () => {
    const id = await seed(), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO provider_operation_records(id,order_id,provider,kind,status,version,case_reference,amount_minor,currency,evidence_at,recorded_by,recorded_at) VALUES(?,?,'paystack','refund','closed_unpaid',2,'PROVIDER-CASE',5000,'GHS',NULL,'fixture',?)`).bind(crypto.randomUUID(),id,now).run();
    const fetchSpy = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({status:true,data:{id:'fixture-only',status:'processing'}}));
    await legacyRefund(env.DB,{orderId:id,actor:'fixture',reason:'Isolated closed case regression',secret:'test-only'});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const current = await env.DB.prepare('SELECT status FROM payment_refunds WHERE order_id=?').bind(id).first();
    expect(current).toEqual({status:'processing'});
  });
});
