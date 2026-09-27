import { emailBrand } from './email-brand';

const origin = 'https://tickets.becoreops.com';
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

/** Move committed review requests into the existing retryable email outbox. */
export async function queueOwnerApprovalAlerts(env: Pick<Cloudflare.Env, 'DB' | 'OPS_ALERT_EMAIL'>) {
  const recipient = env.OPS_ALERT_EMAIL?.trim();
  if (!recipient) return { queued: 0 };
  const pending = await env.DB.prepare(`SELECT kind,target_id AS targetId FROM owner_approval_outbox ORDER BY created_at LIMIT 20`)
    .all<{ kind: 'host' | 'event'; targetId: string }>();
  let queued = 0;
  for (const item of pending.results) {
    const record = item.kind === 'host'
      ? await env.DB.prepare(`SELECT brand_name AS name,contact_name AS contact FROM host_applications WHERE id=? AND status='pending' AND email_verified_at IS NOT NULL`).bind(item.targetId).first<{ name: string; contact: string }>()
      : await env.DB.prepare(`SELECT title AS name,organizer_name AS contact FROM party_submissions WHERE id=? AND status IN ('submitted','in_review')`).bind(item.targetId).first<{ name: string; contact: string }>();
    if (!record) {
      await env.DB.prepare('DELETE FROM owner_approval_outbox WHERE kind=? AND target_id=?').bind(item.kind, item.targetId).run();
      continue;
    }
    const id = `owner-approval/${item.kind}/${item.targetId}`;
    const host = item.kind === 'host';
    const url = `${origin}${host ? '/admin/hosts?application=' : '/admin?submission='}${encodeURIComponent(item.targetId)}`;
    const heading = host ? 'A host application is ready for review.' : 'A new event is ready for review.';
    const subject = `${host ? 'Host application' : 'Event submission'}: ${record.name.replace(/[\r\n]/g, ' ')}`;
    const text = `${heading}\n\n${record.name}\n${host ? 'Contact' : 'Organizer'}: ${record.contact}\n${host ? 'Their email is confirmed.\n' : ''}\nReview: ${url}\n\nSign in to Operations to approve or decline. Opening this link does not approve anything.`;
    const html = `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914">${emailBrand}<p>Operations</p><h1 style="font-size:25px">${heading}</h1><p><strong>${escapeHtml(record.name)}</strong><br>${host ? 'Contact' : 'Organizer'}: ${escapeHtml(record.contact)}</p>${host ? '<p>Their email is confirmed.</p>' : ''}<p><a href="${url}">Review ${host ? 'host application' : 'event submission'}</a></p><p>Sign in to Operations to approve or decline. Opening this link does not approve anything.</p></div>`;
    const now = new Date().toISOString();
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at)
        VALUES (?,'owner_approval_request',?,'failed',0,?,?,?,?)`)
        .bind(id, recipient, JSON.stringify({ subject, text, html, idempotencyKey: id }), now, now, now),
      env.DB.prepare('DELETE FROM owner_approval_outbox WHERE kind=? AND target_id=?').bind(item.kind, item.targetId),
    ]);
    queued += result[0].meta.changes;
  }
  return { queued };
}
