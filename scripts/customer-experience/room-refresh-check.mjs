// Local-only compiled acceptance: fictional records and an ephemeral attendee session; all external traffic is blocked.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,chmodSync,readdirSync,writeFileSync,rmSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {webkit} from '@playwright/test';
const engine=process.env.CUSTOMER_BROWSER??'chromium';assert(['chromium','webkit'].includes(engine));
const out=resolve(process.env.CUSTOMER_EVIDENCE_DIR??'docs/customer-experience/evidence/compiled');mkdirSync(out,{recursive:true});
const isolated=mkdtempSync(join(tmpdir(),'tickets-customer-compiled-'));chmodSync(isolated,0o700);
process.env.WRANGLER_WRITE_LOGS='false';process.env.MINIFLARE_REGISTRY_PATH=join(isolated,'registry');
const result={mode:'room-refresh-compiled',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),helperSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),lockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),scope:'Compiled application, temporary local D1 and fictional website-unlisted event. Existing Room tests intercept auth/Room APIs and sockets; all nonlocal browser and Worker traffic blocked. No queues or persistent credentials.',outboundAttempts:0,cleanup:{},passed:false};
let runtime;
try{
 const {unstable_getMiniflareWorkerOptions}=await import('wrangler');
 const {readD1Migrations}=await import('@cloudflare/vitest-pool-workers');
 const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler'));
 const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=wranglerRequire('miniflare');
 const source=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 const config=join(isolated,'worker.json');
 writeFileSync(config,JSON.stringify({name:'tickets-boardui-local-auth',main:resolve('dist/server/index.js'),compatibility_date:source.compatibility_date,compatibility_flags:source.compatibility_flags,assets:{directory:resolve('dist/client'),binding:'ASSETS'},vars:{ENVIRONMENT:'test'},d1_databases:[{binding:'DB',database_name:'boardui-local-only',database_id:'boardui-local-only'}],ratelimits:source.ratelimits}),{mode:0o600});
 const options=unstable_getMiniflareWorkerOptions(config);delete options.workerOptions.modulesRules;
 const modules=[{type:'ESModule',path:options.main},...readdirSync('dist/server',{recursive:true}).filter(p=>/\.m?js$/u.test(p)&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))];
 const decoy=randomBytes(32).toString('hex');
 runtime=new Miniflare(convertV4MiniflareOptions({...options.workerOptions,modules,modulesRoot:resolve('dist/server'),bindings:{ENVIRONMENT:'test',PAYSTACK_SECRET_KEY:'sk_test_ui_fixture',STAFF_LOGIN_DECOY_SECRET:decoy},resourcePersistencePath:join(isolated,'state'),host:'127.0.0.1',port:8798,https:true,cf:false,log:new Log(LogLevel.NONE),outboundService:async()=>{result.outboundAttempts++;return new Response('External network disabled in isolated acceptance',{status:503});}}));
 const origin=String(await runtime.ready).replace(/\/$/,'');assert.equal(new URL(origin).hostname,'127.0.0.1');assert.equal(new URL(origin).protocol,'https:');result.transport='https';
 const db=await runtime.getD1Database('DB');
 const migrations=await readD1Migrations('./drizzle');for(const migration of migrations)await db.batch(migration.queries.map(q=>db.prepare(q)));
 const now=new Date().toISOString(),start=new Date(Date.now()+7*86400000).toISOString(),end=new Date(Date.now()+8*86400000).toISOString();
 await db.prepare("UPDATE curated_event_records SET removed_at=? WHERE slug != 'sun-chasers-labadi'").bind(now).run();
 const run=async(sql,...args)=>db.prepare(sql).bind(...args).run();
 await run("UPDATE curated_event_records SET removed_at=NULL,title='Fictional unlisted night',starts_at=?,ends_at=?,status='published',event_state='on_sale',schedule_status='confirmed' WHERE slug='sun-chasers-labadi'",start,end);
 result.webkit={path:webkit.executablePath(),available:existsSync(webkit.executablePath()),status:engine==='webkit'?'selected for hosted verification':existsSync(webkit.executablePath())?'not selected':'not installed locally; no download attempted'};
 result.engine=engine;

 const code=await new Promise((resolve,reject)=>{const child=spawn('node',['node_modules/@playwright/test/cli.js','test','tests/e2e/room-shortcut.spec.ts','--config=playwright.room-refresh.config.ts','--workers=1','--retries=0'],{stdio:'inherit',env:{...process.env,E2E_BASE_URL:origin,BECORE_ISOLATED_PREVIEW:'true'}});child.on('error',reject);child.on('close',(code,signal)=>{result.childSignal=signal;resolve(code===0?0:1);});});
 result.passed=code===0;process.exitCode=code;
}finally{await runtime?.dispose();rmSync(isolated,{recursive:true,force:true});result.cleanup={temporaryDatabaseRemoved:!existsSync(isolated),persistentCredentialsCreated:false};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));}
