import { generateRequestDetails } from 'web-push-neo';
import { validPushEndpoint } from './push-subscription';

// Capture only the freshly generated signup ID, in the same transaction as
// consent and welcome mail. Later device opt-ins cannot backfill old signups.
export function captureYorkewayOwnerPush(db: D1Database, signupId: string, now: string) {
  return db.prepare(`INSERT OR IGNORE INTO yorkeway_owner_push_deliveries
    (id,signup_id,subscription_id,account_id,subscription_version,created_at)
    SELECT lower(hex(randomblob(16))),y.id,p.id,p.account_id,p.consent_id,?
    FROM yorkeway_early_access y CROSS JOIN organizer_push_subscriptions p
    JOIN staff_accounts s ON s.id=p.account_id
    JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=s.id
    WHERE y.id=? AND y.status='subscribed' AND p.revoked_at IS NULL
    AND s.role='owner' AND s.status='active' AND s.must_change_password=0
    AND ss.revoked_at IS NULL AND ss.expires_at>?`).bind(now,signupId,now);
}

export async function deliverYorkewayOwnerPush(env: Cloudflare.Env, id: string) {
  const now = new Date().toISOString(), claim = crypto.randomUUID();
  const acquired = await env.DB.prepare(`UPDATE yorkeway_owner_push_deliveries
    SET claim=?,lease_until=?,attempts=attempts+1 WHERE id=? AND completed_at IS NULL
    AND attempts<3 AND (lease_until IS NULL OR lease_until<=?)`)
    .bind(claim,new Date(Date.now()+120000).toISOString(),id,now).run();
  if (!acquired.meta.changes) return;
  const finish = (outcome: string) => env.DB.prepare(`UPDATE yorkeway_owner_push_deliveries
    SET completed_at=?,outcome=?,claim=NULL,lease_until=NULL WHERE id=? AND claim=?`)
    .bind(new Date().toISOString(),outcome,id,claim).run();
  const eligible = () => env.DB.prepare(`SELECT p.id AS subscriptionId,p.endpoint,p.p256dh,p.auth,
    p.consent_id AS subscriptionVersion,d.created_at AS createdAt,d.attempts
    FROM yorkeway_owner_push_deliveries d
    JOIN organizer_push_subscriptions p ON p.id=d.subscription_id AND p.account_id=d.account_id AND p.consent_id=d.subscription_version
    JOIN staff_accounts s ON s.id=p.account_id
    JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=s.id
    JOIN yorkeway_early_access y ON y.id=d.signup_id
    WHERE d.id=? AND d.claim=? AND d.completed_at IS NULL AND d.lease_until>?
    AND p.revoked_at IS NULL AND ss.revoked_at IS NULL AND ss.expires_at>?
    AND s.role='owner' AND s.status='active' AND s.must_change_password=0 AND y.status='subscribed'`)
    .bind(id,claim,new Date().toISOString(),new Date().toISOString())
    .first<{subscriptionId:string;subscriptionVersion:string;endpoint:string;p256dh:string;auth:string;createdAt:string;attempts:number}>();
  const row = await eligible();
  if (!row || Date.parse(row.createdAt)+86400000<=Date.now()) { await finish('ineligible'); return; }
  if (!validPushEndpoint(row.endpoint)) { await finish('invalid_endpoint'); return; }
  let accepted = false;
  try {
    if (!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)) throw new Error('Push unavailable');
    const details = await generateRequestDetails({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({
      kind:'yorkeway_owner_signup',title:'New Yorke Way signup',
      body:'Someone joined the early-access list. Open your audience list.',
      url:'/admin/yorkeway-audience',tag:`yorkeway-signup-${id}`,
    }),{vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY},
      TTL:86400,urgency:'high',topic:id.slice(0,32),signal:AbortSignal.timeout(7000)});
    // Signing is asynchronous: revalidate role, login and device consent again.
    if (!await eligible()) { await finish('ineligible'); return; }
    const response = await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(7000)});
    if (response.status===404 || response.status===410) {
      await env.DB.prepare('UPDATE organizer_push_subscriptions SET revoked_at=?,updated_at=? WHERE id=? AND consent_id=?')
        .bind(now,now,row.subscriptionId,row.subscriptionVersion).run();
      await finish('expired'); return;
    }
    if (!response.ok) throw new Error('Push rejected');
    accepted = true;
  } catch { /* Recover via the durable lease; never log device credentials. */ }
  if (accepted) await finish('accepted');
  else if (row.attempts>=3) await finish('failed');
}

export async function retryYorkewayOwnerPush(env: Cloudflare.Env) {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE yorkeway_owner_push_deliveries SET completed_at=?,outcome='expired'
    WHERE completed_at IS NULL AND (lease_until IS NULL OR lease_until<=?)
    AND (attempts>=3 OR created_at<=?)`).bind(now,now,new Date(Date.now()-86400000).toISOString()).run();
  const rows = await env.DB.prepare(`SELECT id FROM yorkeway_owner_push_deliveries
    WHERE completed_at IS NULL AND attempts<3 AND (lease_until IS NULL OR lease_until<=?)
    ORDER BY created_at LIMIT 50`).bind(now).all<{id:string}>();
  for (const row of rows.results) {
    if (env.EMAIL_DELIVERY_QUEUE) await env.EMAIL_DELIVERY_QUEUE.send({deliveryId:`yorkeway-owner:${row.id}`});
    else if (env.ENVIRONMENT!=='production') await deliverYorkewayOwnerPush(env,row.id);
    else throw new Error('Owner notification queue is unavailable');
  }
}

export async function enqueueYorkewayOwnerPush(db: D1Database, queue: Cloudflare.Env['EMAIL_DELIVERY_QUEUE'], signupId: string) {
  if (!queue) return;
  const rows = await db.prepare(`SELECT id FROM yorkeway_owner_push_deliveries WHERE signup_id=?
    AND completed_at IS NULL AND attempts<3 AND (lease_until IS NULL OR lease_until<=?)
    ORDER BY created_at LIMIT 50`).bind(signupId,new Date().toISOString()).all<{id:string}>();
  if (rows.results.length) await queue.sendBatch(rows.results.map(row=>({body:{deliveryId:`yorkeway-owner:${row.id}`}})));
}
