import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestLoopbackHealth } from '../ops/handover/loopback-health.mjs';
test('private readiness preserves canonical Host without weakening the server guard', async()=>{
 const host='tickets.becoreops.com';
 const server=createServer((req,res)=>{
  if(req.headers.host!==host){res.writeHead(421);res.end();return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({revision:'a'.repeat(40),runtime:'vps',active:false}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const port=server.address().port;
  assert.deepEqual(await requestLoopbackHealth(host,port),{revision:'a'.repeat(40),runtime:'vps',active:false});
  await assert.rejects(requestLoopbackHealth('wrong.example',port),/status rejected/);
 }finally{await new Promise(r=>server.close(r));}
});
