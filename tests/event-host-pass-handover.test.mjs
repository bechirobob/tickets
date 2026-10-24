import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {databaseEvidence,restoreSqlSnapshot} from '../ops/handover/sqlite-snapshot.mjs';
import {writerGuardStatements,transitionWriterSql} from '../ops/handover/writer-lock.mjs';
import {build} from 'esbuild';
const migration=readFileSync(new URL('../drizzle/0069_event_host_pass_invitations.sql',import.meta.url),'utf8');
test('Host invitation identity, consumed hash and state survive the existing SQL snapshot and write fence',()=>{
 const db=new DatabaseSync(':memory:');try{
  const seed="INSERT INTO event_host_pass_invitations(id,event_slug,host_account_id,recipient_email,ticket_id,provision_nonce,created_by,created_at,reused,state,token_hash,expires_at,used_at,claimed_session_id) VALUES('invite','synthetic','host','host@example.com','ticket','nonce','owner','2026',1,'sent','synthetic-hash','2027','2026','session');";
  db.exec(migration+seed);assert.deepEqual(restoreSqlSnapshot(migration+seed,':memory:'),databaseEvidence(db));
  for(const sql of writerGuardStatements(['event_host_pass_invitations']))db.exec(sql);
  const fence=transitionWriterSql('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);db.prepare(fence.sql).all(...fence.params);
  assert.throws(()=>db.exec("UPDATE event_host_pass_invitations SET used_at=NULL"),/paused/);
 }finally{db.close();}
});
const bundle=await build({entryPoints:[new URL('../worker/handover-reconciliation.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {durableWorkChecks}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('Sending and uncertain private invite emails block handover drain',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE delivery_events(kind TEXT,status TEXT)');for(const state of ['sending','uncertain']){db.exec('DELETE FROM delivery_events');db.prepare('INSERT INTO delivery_events VALUES(?,?)').run('event_host_pass',state);assert.equal(db.prepare(durableWorkChecks.deliveries).get().n,1);}}finally{db.close();}
});
