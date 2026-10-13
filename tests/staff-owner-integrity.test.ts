import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PATCH as updateAccount, DELETE as removeAccount } from '../app/api/admin/accounts/route';
import { PATCH as changePassword } from '../app/api/admin/session/route';
import { GET as readActivity, POST as markActivity } from '../app/api/admin/organizer-activity/route';
import { adminCookieHeader, authenticateStaff, createStaffSession, PASSWORD_ITERATIONS, readAdminSession } from '../lib/admin-session';
import * as staffSessions from '../lib/admin-session';

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

type Owner = Awaited<ReturnType<typeof owner>>;
type Change = 'demote' | 'disable' | 'remove';
const changeOwner = (actor: Owner, target: Owner, change: Change) => change === 'remove'
  ? removeAccount(request('DELETE', actor.cookie, { id: target.id }))
  : updateAccount(request('PATCH', actor.cookie, {
    id: target.id, email: target.email, displayName: 'Owner account',
    role: change === 'demote' ? 'support' : 'owner', status: change === 'disable' ? 'disabled' : 'active',
  }));

async function expectPreservedOwner(accounts: Owner[], responses: Response[], change: Change) {
  // Always inspect the security invariant before reporting timing-dependent HTTP differences.
  expect((await activeOwners())?.count).toBe(1);
  expect(responses.filter(response => response.status === 200)).toHaveLength(1);
  const winnerIndex = responses.findIndex(response => response.status === 200);
  const survivor = accounts[winnerIndex], changed = accounts[1 - winnerIndex];
  expect(await env.DB.prepare('SELECT role,status FROM staff_accounts WHERE id=?').bind(survivor.id).first()).toEqual({ role: 'owner', status: 'active' });
  expect(await env.DB.prepare('SELECT role,status FROM staff_accounts WHERE id=?').bind(changed.id).first()).toEqual(change === 'remove' ? null : {
    role: change === 'demote' ? 'support' : 'owner', status: change === 'disable' ? 'disabled' : 'active',
  });
  expect(await readAdminSession(survivor.cookie, env.DB)).toMatchObject({ accountId: survivor.id, role: 'owner' });
  expect(await readAdminSession(changed.cookie, env.DB)).toBeNull();
  expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM staff_sessions WHERE account_id=? AND revoked_at IS NULL').bind(changed.id).first<{count:number}>())?.count).toBe(0);
  expect(await responses[winnerIndex].json()).toEqual(change === 'remove' ? { removed: true } : { updated: true });
  const denied = responses[1 - winnerIndex], body = await denied.json() as {error: string};
  if (denied.status === 403) {
    expect(body).toEqual({ error: 'Owner access is required.' });
  } else if (change === 'remove') {
    expect(denied.status).toBe(409);
    expect(body).toEqual({ error: 'Keep at least one active master account.' });
  } else {
    expect(denied.status).toBe(400);
    expect(Object.keys(body)).toEqual(['error']);
    // The route precheck or the atomic database trigger can win after both authorize.
    expect([
      'Create another active owner before removing the last owner.',
      'Keep at least one active master account.',
      'D1_ERROR: Keep at least one active master account.: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
    ]).toContain(body.error);
  }
}

describe('master-account integrity under concurrent actions', () => {
  for (const change of ['demote', 'disable', 'remove'] as const) {
    it(`retains an active owner when two owners ${change} each other concurrently`, async () => {
      const accounts = await Promise.all([owner('a'), owner('b')]);
      const responses = await Promise.all([changeOwner(accounts[0], accounts[1], change), changeOwner(accounts[1], accounts[0], change)]);
      await expectPreservedOwner(accounts, responses, change);
    });
    it(`rejects the revoked owner before authorization after ${change} commits`, async () => {
      const accounts = await Promise.all([owner('a'), owner('b')]);
      const responses = [await changeOwner(accounts[0], accounts[1], change), await changeOwner(accounts[1], accounts[0], change)];
      await expectPreservedOwner(accounts, responses, change);
      expect(responses.map(response => response.status)).toEqual([200, 403]);
    });
    it(`retains the last owner when both ${change} requests authorize before either mutation`, async () => {
      const accounts = await Promise.all([owner('a'), owner('b')]);
      const original = staffSessions.readAdminSession;
      let arrivals = 0, release!: () => void;
      const authorized = new Promise<void>(resolve => { release = resolve; });
      // Keep real authentication results; only synchronize the two successful reads.
      const barrier = vi.spyOn(staffSessions, 'readAdminSession').mockImplementation(async (...args) => {
        const session = await original(...args);
        expect(session?.role).toBe('owner');
        if (++arrivals === 2) release();
        await authorized;
        return session;
      });
      let responses: Response[];
      try {
        responses = await Promise.all([changeOwner(accounts[0], accounts[1], change), changeOwner(accounts[1], accounts[0], change)]);
      } finally { barrier.mockRestore(); }
      await expectPreservedOwner(accounts, responses, change);
      expect(responses.map(response => response.status).sort()).toEqual([200, change === 'remove' ? 409 : 400]);
    });
  }
});

for (const change of ['demote', 'disable'] as const) it(`atomically blocks the final owner ${change} even when both writers observed two owners`, async () => {
  const accounts = await Promise.all([owner('a'), owner('b')]);
  const observed = await Promise.all([activeOwners(), activeOwners()]);
  expect(observed.map(row => row?.count)).toEqual([2, 2]);
  const results = await Promise.allSettled(accounts.map(account => env.DB.prepare('UPDATE staff_accounts SET role=?,status=? WHERE id=?')
    .bind(change === 'demote' ? 'support' : 'owner', change === 'disable' ? 'disabled' : 'active', account.id).run()));
  expect((await activeOwners())?.count).toBe(1);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect([
    'Keep at least one active master account.',
    'D1_ERROR: Keep at least one active master account.: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
  ], rejected.reason.message).toContain(rejected.reason.message);
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
