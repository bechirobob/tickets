import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase } from '../runtime/vps/database.mjs';
import { consume, archiveSql, retainTerminal } from '../ops/handover-terminal/worker.mjs';
const id='01234567-89ab-4cde-8123-456789abcdef';
async function fixture(){const db=new SqliteDatabase(':memory:');await db.exec("CREATE TABLE _bct_handover_admission(id INTEGER PRIMARY KEY,phase TEXT);INSERT INTO _bct_handover_admission VALUES(1,'active');CREATE TABLE _bct_handover_operations(id TEXT PRIMARY KEY,kind TEXT,started_at TEXT);"+archiveSql);await db.prepare('INSERT INTO _bct_handover_operations VALUES(?,?,?)').bind(id,'http','2026-09-29').run();return db;}
const event=()=>({scriptName:'becore-tickets',outcome:'canceled',eventTimestamp:1790679600000,logs:[{message:[JSON.stringify({handoverOperation:id,kind:'http',phase:'entered'})]}]});
test('terminal cancellation preserves evidence and retires only the exact HTTP lease, idempotently',async()=>{const db=await fixture();try{await consume([event()],{DB:db});await consume([event()],{DB:db});assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first('n'),0);const row=await db.prepare('SELECT * FROM _bct_handover_terminal_operations').first();assert.equal(row.id,id);assert.equal(JSON.parse(row.evidence_json).outcome,'canceled');}finally{db.close();}});
test('ignores unrelated producers, nonterminal outcomes, forged IDs and non-HTTP work',async()=>{const db=await fixture();try{for(const override of [{scriptName:'another-service'},{outcome:'unknown'}])await consume([{...event(),...override}],{DB:db});assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first('n'),1);await assert.rejects(retainTerminal(db,'invalid',{script:'becore-tickets',outcome:'canceled'}));await db.prepare("UPDATE _bct_handover_operations SET kind='queue'").run();await consume([event()],{DB:db});assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first('n'),1);}finally{db.close();}});
test('does not mutate a frozen snapshot',async()=>{const db=await fixture();try{await db.prepare("UPDATE _bct_handover_admission SET phase='frozen'").run();await consume([event()],{DB:db});assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first('n'),1);assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM _bct_handover_terminal_operations').first('n'),0);}finally{db.close();}});
import { matchTerminalEvidence } from '../ops/handover-terminal/evidence.mjs';
test('historical reconciliation requires exact operation, request, producer, version and terminal evidence',()=>{
 const record={id,kind:'http',started_at:'2026-09-29'};
 const log={source:{handoverOperation:id,kind:'http',phase:'entered'},$metadata:{id:'log',requestId:'request'},$workers:{scriptName:'becore-tickets',scriptVersion:{id:'version'}}};
 const end={$metadata:{id:'terminal',requestId:'request',type:'cf-worker-event'},$workers:{scriptName:'becore-tickets',scriptVersion:{id:'version'},outcome:'canceled'}};
 assert.equal(matchTerminalEvidence([record],[log,end]).length,1);
 for(const bad of [{...end,$metadata:{...end.$metadata,requestId:'different'}},{...end,$workers:{...end.$workers,outcome:'unknown'}},{...end,$workers:{...end.$workers,scriptName:'other'}},{...end,$workers:{...end.$workers,scriptVersion:{id:'other'}}}])assert.equal(matchTerminalEvidence([record],[log,bad]).length,0);
 assert.equal(matchTerminalEvidence([{...record,id:crypto.randomUUID()}],[log,end]).length,0);
});
