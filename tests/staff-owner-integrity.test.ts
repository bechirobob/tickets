import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PATCH as updateAccount, DELETE as removeAccount } from '../app/api/admin/accounts/route';
import { PATCH as changePassword } from '../app/api/admin/session/route';
import { GET as readActivity, POST as markActivity } from '../app/api/admin/organizer-activity/route';
import { adminCookieHeader, authenticateStaff, createStaffSession, PASSWORD_ITERATIONS } from '../lib/admin-session';

const origin = 'https://tickets.becoreops.com';
async function owner(label: string) {
  const id = `owner-integrity-${label}-${crypto.randomUUID()}`, now = new Date().toISOString();
  const email = `${id}@example.com`;
  await env.DB.prepare(`INSERT INTO staff_accounts
    (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,?,'owner','test-only-unused-hash','test-only-unused-salt',?,0,'active',?,?,'test',?)`)
    .bind(id,email,label,PASSWORD_ITERATIONS,now,now,now).run();
  return { id, email, cookie: adminCookieHeader(await createStaffSession(env.DB,{id})).split(';')[0] };
}
const request = (method: string, cookie: string, body: unknown, path = 'accounts') => new Request(`${origin}/api/admin/${path}`, {
  method, headers: { cookie, origin, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});
const activeOwners = () => env.DB.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE role='owner' AND status='active'").first<{count:number}>();
afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM staff_sessions WHERE account_id LIKE 'owner-integrity-%'"),
    env.DB.prepare("DELETE FROM staff_accounts WHERE id LIKE 'owner-integrity-%'"),
  ]);
});

describe('master-account integrity under concurrent actions', () => {
  for (const change of ['demote', 'disable'] as const) it(`retains an active owner when two owners ${change} each other concurrently`, async () => {
    const [a,b] = await Promise.all([owner('a'),owner('b')]);
    const update = (actor: typeof a, target: typeof a) => updateAccount(request('PATCH',actor.cookie,{
      id:target.id,email:target.email,displayName:'Owner account',role:change==='demote'?'support':'owner',status:change==='disable'?'disabled':'active',
    }));
    const responses = await Promise.all([update(a,b),update(b,a)]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,400]);
    expect((await activeOwners())?.count).toBe(1);
  });
  it('retains an active owner when two owners remove each other concurrently', async () => {
    const [a,b] = await Promise.all([owner('a'),owner('b')]);
    const responses = await Promise.all([removeAccount(request('DELETE',a.cookie,{id:b.id})),removeAccount(request('DELETE',b.cookie,{id:a.id}))]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
    expect((await activeOwners())?.count).toBe(1);
  });
});

it('blocks organizer activity until a temporary owner password is changed', async () => {
  const account = await owner('temporary');
  await env.DB.prepare('UPDATE staff_accounts SET must_change_password=1 WHERE id=?').bind(account.id).run();
  expect((await readActivity(request('GET',account.cookie,null,'organizer-activity'))).status).toBe(403);
  expect((await markActivity(request('POST',account.cookie,{asOf:new Date().toISOString()},'organizer-activity'))).status).toBe(403);
});

it('counts parallel failed passwords atomically and does not clear a new lock', async () => {
  const account = await owner('locked');
  const results = await Promise.all(Array.from({length:10},()=>authenticateStaff(env.DB,account.email,'invalid-proof')));
  const state = await env.DB.prepare('SELECT failed_login_count AS failures,locked_until AS lockedUntil FROM staff_accounts WHERE id=?').bind(account.id).first<{failures:number;lockedUntil:string|null}>();
  expect(state?.lockedUntil).not.toBeNull();
  expect(Date.parse(state!.lockedUntil!)).toBeGreaterThan(Date.now());
  expect(results.filter(result=>result.reason==='locked')).toHaveLength(6);
  expect((await authenticateStaff(env.DB,account.email,'invalid-proof')).reason).toBe('locked');
});

it('limits current-password guessing through an authenticated account session',async()=>{
  const account=await owner('password-change');
  const limiter=vi.spyOn(env.LOGIN_RATE_LIMITER,'limit').mockResolvedValue({success:false});
  try {
    expect((await changePassword(request('PATCH',account.cookie,{currentPasswordProof:'invalid-proof'},'session'))).status).toBe(429);
    expect(limiter).toHaveBeenCalledWith({key:expect.stringMatching(/^password-change-account:/)});
    expect(limiter).toHaveBeenCalledWith({key:expect.stringMatching(/^password-change-ip:/)});
  } finally { limiter.mockRestore(); }
});
