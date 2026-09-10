import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {requestPayout,applyTransferWebhook} from '../lib/operational-finance';
import type {AdminSession} from '../lib/admin-session';
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
 await applyTransferWebhook(env.DB,{reference:second.reference,status:'reversed'});
 expect(await env.DB.prepare('SELECT status FROM event_settlements WHERE id=?').bind(id).first()).toEqual({status:'held'});
});
