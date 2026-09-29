import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { exportDatabase } from './sqlite-export.mjs';
const root='https://api.cloudflare.com/client/v4/accounts/af75a230de2eea882606db8d9acce473/d1/database';
const headers={authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'};
let database;
async function call(url,body,method='POST') {
  const response=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok || !data.success) { console.error(JSON.stringify({ syntheticOnlyErrors:data.errors })); throw new Error('Synthetic import API failed.'); }
  return data.result;
}
try {
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE records(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT);INSERT INTO records(value) VALUES('synthetic-only'); INSERT INTO records(id,value) VALUES(99,'deleted');DELETE FROM records WHERE id=99;");
  db.exec("CREATE TABLE pictures(id INTEGER PRIMARY KEY,image BLOB); INSERT INTO pictures VALUES(1,zeroblob(160000));");
  const snapshot=exportDatabase(db);db.close();
  database=(await call(root,{name:'tickets-synthetic-return-'+process.env.GITHUB_RUN_ID})).uuid;
  const endpoint=root+'/'+database+'/import';
  const etag=createHash('md5').update(snapshot.sql).digest('hex');
  const upload=await call(endpoint,{action:'init',etag});
  const sent=await fetch(upload.upload_url,{method:'PUT',body:snapshot.sql,signal:AbortSignal.timeout(30000)});
  if(!sent.ok)throw new Error('Synthetic upload failed.');
  let result=await call(endpoint,{action:'ingest',etag,filename:upload.filename});
  for(let attempt=0;attempt<30 && result.status!=='complete';attempt++) {
    if(result.status==='error')throw new Error('Synthetic import failed: '+result.error);
    if(!result.at_bookmark)throw new Error('Synthetic import response has no bookmark: '+JSON.stringify(result));
    await new Promise(resolve=>setTimeout(resolve,1000));result=await call(endpoint,{action:'poll',current_bookmark:result.at_bookmark});
  }
  if(result.status!=='complete')throw new Error('Synthetic import timed out.');
  console.log(JSON.stringify({syntheticD1ReverseImport:true}));
} catch(error) { console.error(error.message);process.exitCode=1; }
finally { if(database) { await call(root+'/'+database,undefined,'DELETE');console.log(JSON.stringify({syntheticDatabaseRemoved:database})); } }
