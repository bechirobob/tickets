import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { observeBackgroundJob, readBackgroundHealth } from '../lib/background-health';
import { readOperationExceptions } from '../lib/operations-exceptions';
import { GET as orders } from '../app/api/admin/orders/route';
import { GET as operations } from '../app/api/admin/operations/route';
import { createStaffSession, type StaffRole } from '../lib/admin-session';

async function staff(role: StaffRole) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,'Health test',?,'test','test',600000,0,'active',?,?,'test',?)`).bind(id, `${id}@example.com`, role, now, now, now).run();
  return `bct_staff=${await createStaffSession(env.DB, { id })}`;
}

describe('owner background work evidence', () => {
  it('distinguishes never observed, failed, healthy and stale work without treating startup as a pass', async () => {
    expect((await readBackgroundHealth(env.DB)).find(job => job.key === 'delivery-loop')?.status).toBe('not_observed');
    await expect(observeBackgroundJob(env.DB, 'delivery-loop', async () => { throw new Error('isolated fixture'); })).rejects.toThrow('isolated fixture');
    expect((await readBackgroundHealth(env.DB)).find(job => job.key === 'delivery-loop')).toMatchObject({ status: 'needs_review', lastSuccessAt: null, failures: 1 });
    await observeBackgroundJob(env.DB, 'delivery-loop', async () => true);
    const successful = (await readBackgroundHealth(env.DB)).find(job => job.key === 'delivery-loop');
    expect(successful).toMatchObject({ status: 'healthy', failures: 0 });
    expect(successful?.lastSuccessAt).toBeTruthy();
    expect((await readBackgroundHealth(env.DB, Date.now() + 6 * 60_000)).find(job => job.key === 'delivery-loop')?.status).toBe('stale');
  });
  it('does not let an older finishing run overwrite a newer failed run', async () => {
    let finish!: () => void;
    const pending = observeBackgroundJob(env.DB, 'scheduled:minute', () => new Promise<void>(resolve => { finish = resolve; }));
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    await observeBackgroundJob(env.DB, 'scheduled:minute', async () => 2, value => value);
    finish(); await pending;
    expect((await readBackgroundHealth(env.DB)).find(job => job.key === 'scheduled:minute')).toMatchObject({ status: 'needs_review', failures: 2 });
  });
  it('separates exhausted delivery from scheduled retry and excludes a replaced success', async () => {
    const suffix = crypto.randomUUID(), now = new Date().toISOString(), earlier = new Date(Date.now() - 600_000).toISOString();
    for (const [name, next] of [['exhausted', null], ['retry', now], ['replaced', null]] as const) {
      await env.DB.prepare(`INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES(?,'host_application_decision',?,'failed',3,?,?,?)`).bind(`${suffix}-${name}`, `${name}-${suffix}@example.com`, next, earlier, earlier).run();
    }
    await env.DB.prepare(`INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,created_at,updated_at) VALUES(?,'host_application_decision',?,'delivered',1,?,?)`).bind(`${suffix}-ok`, `replaced-${suffix}@example.com`, now, now).run();
    const data = await readOperationExceptions(env.DB);
    expect(data.exceptions.find(item => item.key === 'delivery:host_application_decision:needs_review')?.count).toBe(1);
    expect(data.exceptions.find(item => item.key === 'delivery:host_application_decision:retry_scheduled')?.count).toBe(1);
    expect(JSON.stringify(data)).not.toContain('@example.com');
  });
  it('keeps removed-event payment exceptions reachable without changing the default Orders view', async () => {
    const id = crypto.randomUUID(), slug = `removed-${id}`, now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,image_url,curation_note,status,created_at,updated_at,removed_at)
      VALUES(?,?,?,'Removed test event','Venue','Accra',?,?,'Night',10000,'/events/test.webp','Test','unpublished',?,?,?)`).bind(slug,slug,slug,now,now,now,now,now).run();
    await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at)
      VALUES(?,?,?,'general',1,10000,0,10000,'GHS','guest@example.com','233000000000','mobile_money:mtn','seevplus','payment_pending',?)`).bind(id,`BCT-${id}`,slug,new Date(Date.now()-900_000).toISOString()).run();
    const data = await readOperationExceptions(env.DB);
    const attention = data.exceptions.find(item => item.key === 'payment:seevplus')!;
    expect(attention.count).toBeGreaterThan(0);
    expect(attention.href).toBe('/admin/orders?status=payment_pending&provider=seevplus&removed=1');
    const cookie = await staff('owner');
    const hidden = await (await orders(new Request(`https://tickets.becoreops.com/api/admin/orders?event=${slug}`, {headers:{cookie}}))).json() as {orders:Array<{id:string}>};
    expect(hidden.orders).toEqual([]);
    const reachable = await (await orders(new Request(`https://tickets.becoreops.com/api${attention.href}&event=${slug}`, {headers:{cookie}}))).json() as {orders:Array<{id:string}>};
    expect(reachable.orders.map(order => order.id)).toContain(id);
    await env.DB.prepare("UPDATE orders SET status='paid',payment_verified_at=? WHERE id=?").bind(now,id).run();
    await env.DB.prepare(`INSERT INTO provider_operation_records(id,order_id,provider,kind,status,version,case_reference,amount_minor,currency,recorded_by,recorded_at)
      VALUES(?,?,'seevplus','refund','pending',1,'TEST-CASE',10000,'GHS','test',?)`).bind(crypto.randomUUID(),id,now).run();
    const refund = (await readOperationExceptions(env.DB)).exceptions.find(item => item.key === 'external-refund:seevplus')!;
    expect(refund.href).toBe('/admin/orders?provider=seevplus&removed=1');
  });
  it('does not expose the owner queue projection to finance or curator roles', async () => {
    for (const role of ['finance', 'curator', 'owner'] as const) {
      const response = await operations(new Request('https://tickets.becoreops.com/api/admin/operations', { headers: { cookie: await staff(role) } }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect('background' in body).toBe(role === 'owner');
    }
  });
});
