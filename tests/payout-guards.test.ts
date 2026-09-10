import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {requestPayout,applyTransferWebhook} from '../lib/operational-finance';
import type {AdminSession} from '../lib/admin-session';
it('enforces the payout ceiling in the database even when the application reservation is bypassed',async()=>{
 const id=crypto.randomUUID(),overlap=`overlap-${id}`,event=`trigger-${id}`,now=new Date().toISOString();
 for(const settlement of [id,overlap])await env.DB.prepare("INSERT INTO event_settlements (id,run_id,event_slug,period_start,period_end,gross_minor,booking_fees_minor,refunds_minor,net_ticket_sales_minor,currency,status,created_at) VALUES (?,?,?,'2026-09-09T00:00:00Z','2026-09-10T00:00:00Z',10000,0,0,10000,'GHS','ready',?)").bind(settlement,settlement,event,now).run();
 const insert=(settlement:string,amount:number,status='pending_approval')=>env.DB.prepare("INSERT INTO payout_transfers (id,settlement_id,event_slug,payout_account_id,reference,amount_minor,currency,status,initiated_by,created_at,updated_at) VALUES (?,?,?,'fixture',?,?,'GHS',?,'fixture',?,?)").bind(crypto.randomUUID(),settlement,event,crypto.randomUUID(),amount,status,now,now).run();
 await insert(id,6000);
 await expect(insert(overlap,5000)).rejects.toThrow('Settlement balance is already reserved');
 await expect(insert(id,0)).rejects.toThrow('Settlement balance is already reserved');
 await insert(overlap,4000);
 await insert(id,5000,'failed');
 expect(await env.DB.prepare("SELECT SUM(amount_minor) AS reserved FROM payout_transfers WHERE event_slug=? AND status NOT IN ('failed','reversed')").bind(event).first()).toEqual({reserved:10000});
});
it('reserves settlement balance once and only closes it when all funds have been paid',async()=>{
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO event_settlements (id,run_id,event_slug,period_start,period_end,gross_minor,booking_fees_minor,refunds_minor,net_ticket_sales_minor,currency,status,created_at) VALUES (?,?,'after-dark-osu',?,?,10000,0,0,10000,'GHS','ready',?)").bind(id,id,'2026-09-09T00:00:00Z','2026-09-10T00:00:00Z',now),
  env.DB.prepare("INSERT INTO organizer_payout_accounts (id,event_slug,account_name,recipient_type,bank_code,account_number_masked,recipient_code,status,verified_at,created_by,created_at) VALUES (?,'after-dark-osu','Test','mobile_money','MTN','1234','recipient-test','active',?,'fixture',?)").bind(id,now,now),
 ]);
 const actor={accountId:'finance-fixture',email:'finance@example.com',role:'owner',actor:'Finance fixture'} as AdminSession;
 const input={settlementId:id,payoutAccountId:id,amountMinor:6000};
 const results=await Promise.allSettled([requestPayout(env.DB,actor,input),requestPayout(env.DB,actor,input)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const first=results.find(r=>r.status==='fulfilled')!;if(first.status!=='fulfilled')throw new Error('Missing payout');
 await applyTransferWebhook(env.DB,{reference:first.value.reference,status:'success'});
 expect(await env.DB.prepare('SELECT status FROM event_settlements WHERE id=?').bind(id).first()).toEqual({status:'ready'});
 const second=await requestPayout(env.DB,actor,{...input,amountMinor:4000});
 await applyTransferWebhook(env.DB,{reference:second.reference,status:'success'});
 await applyTransferWebhook(env.DB,{reference:second.reference,status:'failed'});
 expect(await env.DB.prepare('SELECT status FROM event_settlements WHERE id=?').bind(id).first()).toEqual({status:'paid'});
 const overlap=`overlap-${id}`;
 await env.DB.prepare("INSERT INTO event_settlements (id,run_id,event_slug,period_start,period_end,gross_minor,booking_fees_minor,refunds_minor,net_ticket_sales_minor,currency,status,created_at) SELECT ?,?,event_slug,period_start,period_end,gross_minor,booking_fees_minor,refunds_minor,net_ticket_sales_minor,currency,'ready',created_at FROM event_settlements WHERE id=?").bind(overlap,overlap,id).run();
 await expect(requestPayout(env.DB,actor,{...input,settlementId:overlap,amountMinor:10000})).rejects.toThrow('already reserved');
 await applyTransferWebhook(env.DB,{reference:second.reference,status:'reversed'});
 expect(await env.DB.prepare('SELECT status FROM event_settlements WHERE id=?').bind(id).first()).toEqual({status:'held'});
});
