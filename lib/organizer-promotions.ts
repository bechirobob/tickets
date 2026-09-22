import { createSecureToken } from './attendee-auth';
import { hashToken, type AdminSession } from './admin-session';
import { dateInput, integerInput, OrganizerError, requireOrganizerEvent, textInput } from './organizer-access';

// A redeemed coupon stays consumed after refunds. Pending attempts hold a slot for 15 minutes.
export const couponUsage = `(SELECT COUNT(*) FROM orders used WHERE used.coupon_id=c.id AND
  (used.status IN ('paid','refund_pending','refunded','disputed') OR (used.status='payment_pending' AND used.reservation_expires_at>?)))`;
export async function couponQuote(db:D1Database,slug:string,tierId:string,code:string,faceMinor:number,feeBps:number) {
  if (!code) return { couponId:null as string|null,discountMinor:0,faceAmountMinor:faceMinor,bookingFeeMinor:Math.round(faceMinor*feeBps/10000),totalAmountMinor:faceMinor+Math.round(faceMinor*feeBps/10000) };
  const now=new Date().toISOString();
  const c=await db.prepare(`SELECT c.id,c.kind,c.value FROM event_coupons c WHERE c.event_slug=? AND c.code=? AND c.status='active'
    AND c.starts_at<=? AND c.expires_at>? AND (c.ticket_tier_id IS NULL OR c.ticket_tier_id=?) AND ${couponUsage}<c.max_uses`)
    .bind(slug,code.trim().toUpperCase(),now,now,tierId,now).first<{id:string;kind:string;value:number}>();
  if(!c)throw new OrganizerError('That code is unavailable for these tickets.');
  const discountMinor=Math.min(faceMinor-100,c.kind==='percent'?Math.round(faceMinor*c.value/10000):c.value);
  if(discountMinor<=0)throw new OrganizerError('This code needs a ticket total above GHS 1.');
  const faceAmountMinor=faceMinor-discountMinor,bookingFeeMinor=Math.round(faceAmountMinor*feeBps/10000);
  return {couponId:c.id,discountMinor,faceAmountMinor,bookingFeeMinor,totalAmountMinor:faceAmountMinor+bookingFeeMinor};
}
export async function createCoupon(db:D1Database,session:AdminSession,body:Record<string,unknown>){
  const e=await requireOrganizerEvent(db,session,body.eventSlug);
  const code=textInput(body.code,'discount code',32,2).toUpperCase();
  if(!/^[A-Z0-9_-]+$/u.test(code))throw new OrganizerError('Use letters, numbers, underscores or hyphens in the code.');
  const kind=body.kind;if(kind!=='percent'&&kind!=='fixed')throw new OrganizerError('Choose a percentage or fixed discount.');
  const value=integerInput(body.value,'discount',1,kind==='percent'?9900:10_000_000),maxUses=integerInput(body.maxUses,'redemptions',1,50000);
  const startsAt=dateInput(body.startsAt,'start time'),expiresAt=dateInput(body.expiresAt,'expiry');
  if(expiresAt<=startsAt||expiresAt<=new Date().toISOString())throw new OrganizerError('Expiry must be after the start time and in the future.');
  const tierId=body.tierId?textInput(body.tierId,'ticket type',120):null;
  if(tierId&&!await db.prepare('SELECT 1 FROM event_ticket_tiers WHERE id=? AND event_slug=?').bind(tierId,e.slug).first())throw new OrganizerError('Choose a ticket type from this Night.');
  const id=crypto.randomUUID();
  const result=await db.prepare(`INSERT OR IGNORE INTO event_coupons(id,event_slug,code,ticket_tier_id,kind,value,max_uses,starts_at,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,e.slug,code,tierId,kind,value,maxUses,startsAt,expiresAt,session.accountId,new Date().toISOString()).run();
  if(!result.meta.changes)throw new OrganizerError('That code already exists. Choose another code.',409);
  return {id};
}
// Snapshot the rate on each order. Refunds reduce the ticket face value proportionally.
export const commissionAmount = `CASE WHEN o.status IN ('paid','refund_pending','refunded') AND o.total_amount_minor>0 THEN
 CAST(ROUND(MAX(0,o.face_amount_minor-ROUND(o.refunded_amount_minor*1.0*o.face_amount_minor/o.total_amount_minor))*o.promoter_commission_bps/10000.0) AS INTEGER) ELSE 0 END`;
export async function promoterReport(db:D1Database,id:string){
  const p=await db.prepare(`SELECT p.id,p.event_slug AS eventSlug,p.code,p.label,p.status,p.commission_bps AS commissionBps,e.title AS eventTitle
    FROM event_promoter_codes p JOIN curated_event_records e ON e.slug=p.event_slug AND e.removed_at IS NULL WHERE p.id=?`).bind(id).first();
  if(!p)throw new OrganizerError('Promoter not found.',404);
  const totals=await db.prepare(`SELECT COUNT(CASE WHEN o.status IN ('paid','refund_pending','refunded') THEN 1 END) AS orders,
    COALESCE(SUM(CASE WHEN o.status IN ('paid','refund_pending','refunded') THEN o.face_amount_minor ELSE 0 END),0) AS salesMinor,
    COALESCE(SUM(${commissionAmount}),0) AS earnedMinor FROM orders o WHERE o.event_slug=? AND o.promoter_code=?`).bind(p.eventSlug,p.code).first<{orders:number;salesMinor:number;earnedMinor:number}>();
  const payments=await db.prepare('SELECT id,amount_minor AS amountMinor,reference,paid_at AS paidAt FROM promoter_payments WHERE promoter_id=? ORDER BY paid_at DESC').bind(id).all<{id:string;amountMinor:number;reference:string;paidAt:string}>();
  const paidMinor=payments.results.reduce((n,x)=>n+x.amountMinor,0),earnedMinor=totals?.earnedMinor??0;
  return {...p,...totals,paidMinor,balanceMinor:earnedMinor-paidMinor,payments:payments.results};
}
export async function managePromoter(db:D1Database,session:AdminSession,b:Record<string,unknown>){
  const e=await requireOrganizerEvent(db,session,b.eventSlug);
  if(b.action==='promoter_create'){
    const code=textInput(b.code,'promoter code',32,2).toUpperCase(),label=textInput(b.label,'promoter name',100);
    if(!/^[A-Z0-9_-]+$/u.test(code))throw new OrganizerError('Use letters, numbers, underscores or hyphens in the code.');
    const rate=integerInput(b.commissionBps,'commission percentage',0,5000),id=crypto.randomUUID();
    const r=await db.prepare("INSERT OR IGNORE INTO event_promoter_codes(id,event_slug,code,label,status,created_at,created_by,commission_bps) VALUES (?,?,?,?,'active',?,?,?)").bind(id,e.slug,code,label,new Date().toISOString(),session.accountId,rate).run();
    if(!r.meta.changes)throw new OrganizerError('That promoter code already exists.',409);
    return {id};
  }
  const id=textInput(b.id,'promoter',120),p=await db.prepare('SELECT id FROM event_promoter_codes WHERE id=? AND event_slug=?').bind(id,e.slug).first();
  if(!p)throw new OrganizerError('Promoter not found.',404);
  if(b.action==='promoter_portal'){
    const token=createSecureToken(),expiresAt=new Date(Date.now()+90*86400000).toISOString();
    await db.prepare('UPDATE event_promoter_codes SET portal_token_hash=?,portal_expires_at=? WHERE id=?').bind(await hashToken(token),expiresAt,id).run();
    return {url:`https://tickets.becoreops.com/promoter#token=${token}`,expiresAt};
  }
  if(b.action==='promoter_update'){
    const rate=integerInput(b.commissionBps,'commission percentage',0,5000);
    if(b.status!=='active'&&b.status!=='disabled')throw new OrganizerError('Choose an active or disabled link.');
    await db.prepare("UPDATE event_promoter_codes SET commission_bps=?,status=?,portal_token_hash=CASE WHEN ?='disabled' THEN NULL ELSE portal_token_hash END WHERE id=?").bind(rate,b.status,b.status,id).run();return {saved:true};
  }
  if(b.action==='promoter_payment'){
    const amount=integerInput(b.amountMinor,'payment amount',1,100_000_000),reference=textInput(b.reference,'payment reference',120,3),paidAt=dateInput(b.paidAt,'payment date'),paymentId=textInput(b.paymentId,'payment record',80);
    if(paidAt>new Date().toISOString())throw new OrganizerError('Record a completed payment, not a future one.');
    const existing=await db.prepare('SELECT promoter_id AS promoterId,amount_minor AS amountMinor,reference,paid_at AS paidAt FROM promoter_payments WHERE id=?').bind(paymentId).first<{promoterId:string;amountMinor:number;reference:string;paidAt:string}>();
    if(existing){if(existing.promoterId!==id||existing.amountMinor!==amount||existing.reference!==reference||existing.paidAt!==paidAt)throw new OrganizerError('This payment record changed. Refresh and retry.',409);return {recorded:true};}
    const result=await db.prepare(`INSERT OR IGNORE INTO promoter_payments(id,promoter_id,amount_minor,reference,paid_at,recorded_by,created_at)
      SELECT ?,?,?,?,?,?,? WHERE ? <= (SELECT COALESCE(SUM(${commissionAmount}),0) FROM orders o WHERE o.event_slug=? AND o.promoter_code=(SELECT code FROM event_promoter_codes WHERE id=?))
      -(SELECT COALESCE(SUM(amount_minor),0) FROM promoter_payments WHERE promoter_id=?)`).bind(paymentId,id,amount,reference,paidAt,session.accountId,new Date().toISOString(),amount,e.slug,id,id).run();
    if(!result.meta.changes)throw new OrganizerError('The reference already exists or this exceeds the unpaid commission. Refresh the balance.',409);
    return {recorded:true};
  }
  throw new OrganizerError('Choose a promoter action.');
}

export async function listPromoterReports(db:D1Database,slug:string){
  const rows=await db.prepare(`SELECT p.id,p.event_slug AS eventSlug,p.code,p.label,p.status,p.commission_bps AS commissionBps,e.title AS eventTitle,
    COUNT(CASE WHEN o.status IN ('paid','refund_pending','refunded') THEN 1 END) AS orders,
    COALESCE(SUM(CASE WHEN o.status IN ('paid','refund_pending','refunded') THEN o.face_amount_minor ELSE 0 END),0) AS salesMinor,
    COALESCE(SUM(${commissionAmount}),0) AS earnedMinor,
    (SELECT COALESCE(SUM(amount_minor),0) FROM promoter_payments WHERE promoter_id=p.id) AS paidMinor
    FROM event_promoter_codes p JOIN curated_event_records e ON e.slug=p.event_slug
    LEFT JOIN orders o ON o.event_slug=p.event_slug AND o.promoter_code=p.code WHERE p.event_slug=? GROUP BY p.id ORDER BY p.label LIMIT 100`).bind(slug).all<{id:string;earnedMinor:number;paidMinor:number}>();
  const payments=await db.prepare(`SELECT * FROM (SELECT pay.id,pay.promoter_id AS promoterId,pay.amount_minor AS amountMinor,pay.reference,pay.paid_at AS paidAt,
    ROW_NUMBER() OVER (PARTITION BY pay.promoter_id ORDER BY pay.paid_at DESC) AS rownum FROM promoter_payments pay JOIN event_promoter_codes p ON p.id=pay.promoter_id WHERE p.event_slug=?) WHERE rownum<=100`).bind(slug).all<{id:string;promoterId:string;amountMinor:number;reference:string;paidAt:string}>();
  return rows.results.map(p=>({...p,balanceMinor:p.earnedMinor-p.paidMinor,payments:payments.results.filter(x=>x.promoterId===p.id)}));
}
