import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('owner prompt and settings use shared account identity in both existing workspaces',()=>{
 assert.match(read('app/admin/page.tsx'),/accountId=\{session.accountId\}/u);
 assert.match(read('app/admin/curation-desk.tsx'),/role === "owner" && accountId \? <HostRsvpAlerts accountId=\{accountId\} owner mode="prompt"/u);
 assert.match(read('app/admin/operations/page.tsx'),/accountId=\{session.accountId\}/u);
 assert.match(read('app/admin/operations/event-operations-hub.tsx'),/role === "owner" && accountId \? <HostRsvpAlerts accountId=\{accountId\} owner mode="prompt"/u);
 assert.match(read('app/admin/account/page.tsx'),/session.role === "owner" && !session.mustChangePassword \? <HostRsvpAlerts accountId=\{session.accountId\} owner/u);
 const suite=read('app/organizer/workspace/organizer-suite.tsx');
 assert.equal((suite.match(/<HostRsvpAlerts owner=\{role==='owner'\} accountId=\{accountId\}/gu)||[]).length,2);
 assert.match(suite,/\(role==='organizer'\|\|role==='owner'\)&&accountId/u);
 assert.match(read('app/organizer/workspace/host-rsvp-alerts.tsx'),/bct:host-notifications:choice:v1:\$\{accountId\}/u);
 assert.match(read('styles/workspace.css'),/host-rsvp-alerts.css/u);
});
