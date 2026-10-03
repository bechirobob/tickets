import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { GET as workspace } from '../app/api/organizer/workspace/route';
import { GET as analytics } from '../app/api/organizer/analytics/route';
import { adminCookieHeader, createStaffSession } from '../lib/admin-session';

it.each([['workspace',workspace],['analytics?eventSlug=all&range=all',analytics]] as const)('loads 105 assigned events through %s without exposing an unassigned event', async (path, handler) => {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const slugs = Array.from({ length: 105 }, (_, i) => `scale-${id}-${i}`);
  const outside = `outside-${id}`;
  await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,'Scale host','organizer','test','test',600000,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,now,now,now).run();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,image_url,curation_note,status,created_at,updated_at)
      SELECT value,value,value,value,'Venue','Accra',?,?, 'Late night',10000,20,'/test.jpg','Scale fixture','published',?,? FROM json_each(?)`)
      .bind(new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+90000000).toISOString(),now,now,JSON.stringify([...slugs,outside])),
    env.DB.prepare(`INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) SELECT ?,value,'test',? FROM json_each(?)`).bind(id,now,JSON.stringify(slugs)),
    env.DB.prepare(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,created_at,updated_at)
      SELECT value||'-tier',value,'general','General','Admission',100,1,20,10,'available',?,? FROM json_each(?)`).bind(now,now,JSON.stringify([...slugs,outside])),
    env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at,paid_at)
      SELECT value||'-order',value||'-ref',value,'general',1,100,0,100,'GHS','synthetic@example.com','','card','paystack','paid',?,? FROM json_each(?)`).bind(now,now,JSON.stringify([...slugs,outside])),
    env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at)
      SELECT value||'-rsvp',value,'synthetic@example.com','Synthetic guest',1,'rsvp','confirmed',?,? FROM json_each(?)`).bind(now,now,JSON.stringify([...slugs,outside])),
  ]);
  const cookie = adminCookieHeader(await createStaffSession(env.DB,{id}));
  const response = await handler(new Request(`https://tickets.becoreops.com/api/organizer/${path}`,{headers:{cookie}}));
  expect(response.status).toBe(200);
  const body = await response.json() as { events: Array<{slug:string}>; tiers?: unknown[]; overview?: {paidOrders:number;revenueMinor:number}; rsvp?: {totals:{requests:number}} };
  expect(body.events).toHaveLength(105);
  expect(JSON.stringify(body)).not.toContain(outside);
  if (path === 'workspace') expect(body.tiers).toHaveLength(105);
  else {
    expect(body.overview).toMatchObject({paidOrders:105,revenueMinor:10500});
    expect(body.rsvp?.totals.requests).toBe(105);
  }
});
