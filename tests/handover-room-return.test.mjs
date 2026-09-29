import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('actual SQLite Durable Object restores Room history atomically and retains its freeze', async () => {
  const bundled = await build({ stdin: { contents: `
    import { DurableObject } from 'cloudflare:workers';
    import { restoreFrozenRoom } from './worker/room-return';
    import { writerGuardStatements, transitionWriterSql } from './ops/handover/writer-lock.mjs';
    export class TestRoom extends DurableObject {
      async exercise() {
        const s=this.ctx.storage;
        s.sql.exec('CREATE TABLE room_config(id INTEGER PRIMARY KEY,event_slug TEXT); CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,content TEXT); CREATE TABLE reactions(message_id TEXT,attendee_id TEXT,emoji TEXT,PRIMARY KEY(message_id,attendee_id,emoji));');
        s.sql.exec("INSERT INTO messages VALUES(1,'old','old');");
        const transfer=crypto.randomUUID();
        for(const sql of writerGuardStatements(['room_config','messages','reactions'])) s.sql.exec(sql);
        const freeze=transitionWriterSql(transfer,true); s.sql.exec(freeze.sql,...freeze.params).toArray();
        const snapshot={tables:{room_config:[{id:1,event_slug:'original-event'}],messages:[{sequence:93,id:'preserved-id',content:'Hello 🔥'}],reactions:[{message_id:'preserved-id',attendee_id:'same-guest',emoji:'❤️'}]},sequences:[{name:'messages',seq:200}],alarm:null};
        restoreFrozenRoom(s,transfer,snapshot);
        const original=JSON.stringify(s.sql.exec('SELECT * FROM messages').toArray());
        const bad=structuredClone(snapshot); bad.tables.messages.push({...bad.tables.messages[0],sequence:94});
        let rejected=false; try{restoreFrozenRoom(s,transfer,bad);}catch{rejected=true;}
        let otherRejected=false; try{restoreFrozenRoom(s,crypto.randomUUID(),snapshot);}catch{otherRejected=true;}
        let writeRejected=false; try{s.sql.exec("INSERT INTO messages(id,content) VALUES('new','blocked')");}catch{writeRejected=true;}
        return {rejected,otherRejected,writeRejected,unchanged:original===JSON.stringify(s.sql.exec('SELECT * FROM messages').toArray()),sequence:s.sql.exec("SELECT seq FROM sqlite_sequence WHERE name='messages'").one().seq,frozen:s.sql.exec('SELECT frozen FROM _bct_handover_state').one().frozen,rows:s.sql.exec('SELECT * FROM messages').toArray()};
      }
    }
    export default {async fetch(request,env){return Response.json(await env.ROOM.getByName('return-test').exercise());}};
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', external: ['cloudflare:workers'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-08-11', durableObjects: { ROOM: { className: 'TestRoom', useSQLite: true } } }));
  try {
    const result = await (await mf.dispatchFetch('https://test/')).json();
    assert.deepEqual(result, { rejected: true, otherRejected: true, writeRejected: true, unchanged: true, sequence: 200, frozen: 1, rows: [{ sequence: 93, id: 'preserved-id', content: 'Hello 🔥' }] });
  } finally { await mf.dispose(); }
});

import { generateKeyPairSync } from 'node:crypto';
import { openEnvelope } from '../ops/handover/open-envelope.mjs';
test('frozen live Rooms retain alarms without platform retries consuming them', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const due = Date.now() + 3600000;
  const bundled = await build({ stdin: { contents: `
    import { TheRoom } from './worker/the-room';
    import { controlSchema } from './worker/handover-control';
    export class AlarmRoom extends TheRoom {
      async seedAlarm(due){await this.ctx.storage.setAlarm(due)}
      async platformAlarm(){return this.ctx.storage.getAlarm()}
      async invokeAlarm(){return this.alarm()}
    }
    export default {async fetch(request,env){
      await env.DB.batch(controlSchema.map(sql=>env.DB.prepare(sql)));
      const id='01234567-89ab-4cde-8123-456789abcdef';
      await env.DB.prepare("UPDATE _bct_handover_admission SET phase='paused',transfer_id=? WHERE id=1").bind(id).run();
      const room=env.ROOM.getByName('alarm-handover');
      await room.seedAlarm(${due});await room.freezeHandover(id);await room.invokeAlarm();
      const frozen=await room.encryptedHandoverSnapshot();
      const inactive=await room.platformAlarm();
      const restored=await room.restoreHandover(id,{tables:{room_config:[],messages:[],reactions:[]},sequences:[],alarm:${due + 1000}});
      await room.invokeAlarm();const stillInactive=await room.platformAlarm();
      await room.resumeHandover(id);const resumed=await room.platformAlarm();
      return Response.json({frozen,restored,inactive,stillInactive,resumed});
    }};
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', external: ['cloudflare:workers'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-08-11', compatibilityFlags:['nodejs_compat'], durableObjects: { ROOM: { className: 'AlarmRoom', useSQLite: true } }, d1Databases:['DB'], bindings:{
    HANDOVER_RECIPIENT_SPKI:pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),HANDOVER_EXPIRES_AT:new Date(Date.now()+600000).toISOString(),HANDOVER_TRACKING:'1',RELEASE_SHA:'a'.repeat(40)
  } }));
  try {
    const response=await mf.dispatchFetch('https://test/'); const body=await response.text(); assert.equal(response.status,200,body); const result=JSON.parse(body);
    assert.equal(result.inactive,null);assert.equal(result.stillInactive,null);
    assert.equal(openEnvelope(result.frozen,pair.privateKey,'room-cutover').alarm,due);
    assert.equal(openEnvelope(result.restored,pair.privateKey,'room-cutover').alarm,due+1000);
    assert.equal(result.resumed,due+1000);
  } finally {await mf.dispose()}
});
