import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { roomSnapshot, restoreRoomSnapshot } from '../ops/handover/sqlite-snapshot.mjs';
import { writerGuardStatements, transitionWriterSql } from '../ops/handover/writer-lock.mjs';

const schema=`CREATE TABLE room_config(id INTEGER PRIMARY KEY,event_slug TEXT);
 CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE);
 CREATE TABLE reactions(message_id TEXT,attendee_id TEXT,emoji TEXT);
 CREATE TABLE room_host_posts(host_account_id TEXT PRIMARY KEY,message_id TEXT UNIQUE,sender_attendee_id TEXT,created_at TEXT,completed_at TEXT);`;
test('host first-post receipts survive Room snapshot restore and remain writer-frozen',()=>{
 const a=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');
 try{
  a.exec(schema);b.exec(schema);
  a.prepare('INSERT INTO room_host_posts VALUES(?,?,?,?,?)').run('host','first-post','guest','2026-10-24','2026-10-24');
  restoreRoomSnapshot(b,roomSnapshot(a));
  assert.deepEqual(roomSnapshot(b),roomSnapshot(a));
  for(const sql of writerGuardStatements(['room_config','messages','reactions','room_host_posts']))b.exec(sql);
  const command=transitionWriterSql('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);b.prepare(command.sql).all(...command.params);
  assert.throws(()=>b.exec('DELETE FROM room_host_posts'),/paused/);
 }finally{a.close();b.close();}
});

import { build } from 'esbuild';
const bundled = await build({ entryPoints: [new URL('../worker/room-return.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
const { restoreFrozenRoom } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function frozenReceipt() {
 const db = new DatabaseSync(':memory:'); db.exec(schema);
 const receipt = { host_account_id:'host', message_id:'first-post', sender_attendee_id:'guest', created_at:'2026-10-24', completed_at:'2026-10-24' };
 db.prepare('INSERT INTO room_host_posts VALUES(?,?,?,?,?)').run(...Object.values(receipt));
 for (const sql of writerGuardStatements(['room_config','messages','reactions','room_host_posts'])) db.exec(sql);
 const transfer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', command = transitionWriterSql(transfer,true);
 db.prepare(command.sql).all(...command.params);
 const storage = {
  sql: { exec(sql,...args) { const rows=db.prepare(sql).all(...args); return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}}; } },
  transactionSync(fn) { db.exec('BEGIN IMMEDIATE');try {fn();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;} },
 };
 const snapshot = {tables:{room_config:[],messages:[],reactions:[],room_host_posts:[{...receipt}]},sequences:[],alarm:null};
 return {db,storage,transfer,receipt,snapshot};
}
for (const mutation of ['missing','empty','host_account_id','message_id','sender_attendee_id','created_at']) {
 test(`Room return rejects ${mutation} host receipt loss without changing the frozen target`,()=>{
  const f=frozenReceipt();try {
   if(mutation==='missing')delete f.snapshot.tables.room_host_posts;
   else if(mutation==='empty')f.snapshot.tables.room_host_posts=[];
   else f.snapshot.tables.room_host_posts[0][mutation]='changed';
   assert.throws(()=>restoreFrozenRoom(f.storage,f.transfer,f.snapshot),/cannot discard|replace/);
   assert.deepEqual({...f.db.prepare('SELECT * FROM room_host_posts').get()},f.receipt);
   assert.equal(f.db.prepare('SELECT frozen FROM _bct_handover_state').get().frozen,1);
  }finally{f.db.close();}
 });
}
test('Room return preserves receipt identity while carrying pending cancellation and new receipts',()=>{
 const f=frozenReceipt();try {
  f.snapshot.tables.room_host_posts[0].completed_at=null;
  f.snapshot.tables.room_host_posts.push({...f.receipt,host_account_id:'next-host',message_id:'next-first-post'});
  restoreFrozenRoom(f.storage,f.transfer,f.snapshot);
  assert.deepEqual(roomSnapshot(f.db).room_host_posts,f.snapshot.tables.room_host_posts);
  assert.equal(f.db.prepare('SELECT frozen FROM _bct_handover_state').get().frozen,1);
  assert.throws(()=>f.db.exec('DELETE FROM room_host_posts'),/paused/);
 }finally{f.db.close();}
});

const drainBundle = await build({ entryPoints: [new URL('../worker/handover-reconciliation.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
const { durableWorkChecks } = await import('data:text/javascript;base64,' + Buffer.from(drainBundle.outputFiles[0].text).toString('base64'));
test('first-host sending and uncertain deliveries prevent handover drain without broadening other delivery kinds',()=>{
 const db=new DatabaseSync(':memory:');try {
  db.exec('CREATE TABLE delivery_events(kind TEXT,status TEXT)');
  for(const status of ['sending','uncertain']) {
   db.prepare('INSERT INTO delivery_events VALUES(?,?)').run('room_host_post',status);
   assert.equal(db.prepare(durableWorkChecks.deliveries).get().n,1);
   db.exec('DELETE FROM delivery_events');
   db.prepare('INSERT INTO delivery_events VALUES(?,?)').run('ticket_recovery',status);
   assert.equal(db.prepare(durableWorkChecks.deliveries).get().n,0);
   db.exec('DELETE FROM delivery_events');
  }
  for(const status of ['queued','sent','delayed'])db.prepare('INSERT INTO delivery_events VALUES(?,?)').run('ticket_recovery',status);
  assert.equal(db.prepare(durableWorkChecks.deliveries).get().n,3);
 }finally{db.close();}
});
