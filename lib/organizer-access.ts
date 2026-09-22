import { hasPermission, readAdminSession, type AdminSession } from './admin-session';

export class OrganizerError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const privateHeaders = { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer' };
// The same scope is used for list, aggregate and record access. Values never enter SQL text.
export function organizerScope(session: AdminSession, alias = 'e') {
  return session.role === 'owner' ? { sql: '1=1', bindings: [] as string[] } : {
    sql: `EXISTS (SELECT 1 FROM staff_event_assignments a WHERE a.event_slug=${alias}.slug AND a.account_id=?)`,
    bindings: [session.accountId],
  };
}
export async function organizerSession(request: Request, db: D1Database) {
  const session = await readAdminSession(request.headers.get('cookie'), db);
  if (!session || session.mustChangePassword || !hasPermission(session, 'organizer.workspace')) throw new OrganizerError('Sign in with your organiser account to continue.', 403);
  return session;
}
export async function requireOrganizerEvent(db: D1Database, session: AdminSession, slug: unknown, lead = false) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(slug)) throw new OrganizerError('Choose a Night.');
  const scope = organizerScope(session);
  const event = await db.prepare(`SELECT e.slug,e.title,e.status,e.event_state AS eventState,e.starts_at AS startsAt,e.ends_at AS endsAt,
    CASE WHEN e.organizer_owner_id=? OR EXISTS (SELECT 1 FROM party_submissions s WHERE s.id=e.submission_id AND lower(trim(s.contact_email))=?) THEN 1 ELSE 0 END AS isLead
    FROM curated_event_records e WHERE e.slug=? AND e.removed_at IS NULL AND ${scope.sql}`)
    .bind(session.accountId,session.email,slug,...scope.bindings).first<{slug:string;title:string;status:string;eventState:string;startsAt:string;endsAt:string;isLead:number}>();
  if (!event || lead && session.role !== 'owner' && !event.isLead) throw new OrganizerError(lead ? 'Only the lead host can manage this event’s team.' : 'This Night is not assigned to your account.',403);
  return event;
}
export function textInput(value: unknown, label: string, max = 120, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new OrganizerError(`Add a valid ${label}.`);
  return value.trim();
}
export function integerInput(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new OrganizerError(`Choose ${label} between ${min} and ${max}.`);
  return value;
}
export function dateInput(value: unknown, label: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new OrganizerError(`Choose a valid ${label}.`);
  return new Date(value).toISOString();
}
export function emailInput(value: unknown) {
  const email = textInput(value,'email address',254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new OrganizerError('Add a valid email address.');
  return email;
}
export function csvResponse(rows: unknown[][], filename: string) {
  const cell = (value: unknown) => { let s=String(value ?? ''); if (/^[\s]*[=+\-@]/u.test(s)) s=`'${s}`; return `"${s.replaceAll('"','""')}"`; };
  return new Response(rows.map(row=>row.map(cell).join(',')).join('\r\n'),{headers:{...privateHeaders,'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${filename}.csv"`}});
}
