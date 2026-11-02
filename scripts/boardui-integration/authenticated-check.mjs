// Approved, local-only acceptance. Passwords stay in memory; sessions come only from real app login.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,chmodSync,readdirSync,writeFileSync,rmSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomBytes,pbkdf2Sync,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const out=resolve('docs/boardui-integration/evidence/authenticated');mkdirSync(out,{recursive:true});
const isolated=mkdtempSync(join(tmpdir(),'tickets-boardui-auth-'));chmodSync(isolated,0o700);
process.env.WRANGLER_WRITE_LOGS='false';process.env.MINIFLARE_REGISTRY_PATH=join(isolated,'registry');
const result={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),helperSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),lockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),scope:'Compiled application, real password login, dedicated local D1; no injected sessions or mocked API responses.',checks:[],pageErrors:[],csp:[],blockedBrowserRequests:[],outboundAttempts:0,cleanup:{},passed:false};
let stage='runtime setup',runtime,browser;const secrets=[];
const credentials=['owner','organizer'].map(role=>{const password=`Local9!${randomBytes(24).toString('hex')}`;secrets.push(password);return {role,id:`fixture-${role}`,email:`${role}@boardui.example.test`,password};});
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
 const decoy=randomBytes(32).toString('hex');secrets.push(decoy);
 runtime=new Miniflare(convertV4MiniflareOptions({...options.workerOptions,modules,modulesRoot:resolve('dist/server'),bindings:{ENVIRONMENT:'test',STAFF_LOGIN_DECOY_SECRET:decoy},resourcePersistencePath:join(isolated,'state'),host:'127.0.0.1',port:8797,https:true,cf:false,log:new Log(LogLevel.NONE),outboundService:async()=>{result.outboundAttempts++;return new Response('External network disabled in isolated acceptance',{status:503});}}));
 const origin=String(await runtime.ready).replace(/\/$/,'');assert.equal(new URL(origin).hostname,'127.0.0.1');
 const db=await runtime.getD1Database('DB');stage='schema migration';
 const migrations=await readD1Migrations('./drizzle');for(const migration of migrations)await db.batch(migration.queries.map(q=>db.prepare(q)));
 stage='local account setup';const now=new Date().toISOString();
 for(const account of credentials){const salt=randomBytes(16).toString('base64url'),proof=pbkdf2Sync(account.password,Buffer.from(salt,'base64url'),600000,32,'sha256'),hash='client-pbkdf2-sha256-v1.'+createHash('sha256').update(proof).digest('base64url');secrets.push(salt,hash,proof.toString('base64url'));
  await db.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,?,?,?,?,600000,0,'active',?,?,?,?)`).bind(account.id,account.email,`Fictional ${account.role}`,account.role,hash,salt,now,now,'local-acceptance-only',now).run();
 }
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_accounts').first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').first()).n,0);
 stage='fictional records setup';await db.prepare('UPDATE curated_event_records SET removed_at=?').bind(now).run();
 const start=new Date(Date.now()+7*86400000).toISOString(),end=new Date(Date.now()+8*86400000).toISOString();
 for(const slug of ['fixture-assigned','fixture-owner-only']){
  await db.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,venue_map_url,area,starts_at,ends_at,vibe,price_from_minor,capacity,age_restriction,lineup,image_url,curation_note,status,created_at,updated_at,is_test_event,schedule_status,event_state,organizer_owner_id) VALUES(?,?,?,?,?,'https://example.test/map','Accra',?,?,'Night',15000,100,'18+','Fictional DJ','/events/the-weekend-braai.jpeg','Fictional local acceptance event','published',?,?,0,'confirmed','on_sale',?)`).bind(slug,slug,slug,slug==='fixture-assigned'?'Fictional assigned Night':'Fictional owner-only Night','Fictional courtyard',start,end,now,now,slug==='fixture-assigned'?'fixture-organizer':'fixture-owner').run();
 }
 await db.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind('fixture-organizer','fixture-assigned','fixture-owner',now).run();
 await db.prepare(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,sort_order,created_at,updated_at) VALUES('fixture-tier','fixture-assigned','standard','Fictional standard','Fictional admission',15000,1,100,5,'available',0,?,?)`).bind(now,now).run();
 for(let i=1;i<=31;i++)await db.prepare(`INSERT INTO event_questions(id,event_slug,prompt,kind,required,sort_order,status,created_at) VALUES(?,'fixture-assigned',?,'text',0,?,'active',?)`).bind(`fixture-q${i}`,`Fictional question ${i}`,i,now).run();
 await db.prepare(`INSERT INTO event_questions(id,event_slug,prompt,kind,required,sort_order,status,created_at) VALUES('fixture-owner-q','fixture-owner-only','Fictional owner question','text',0,0,'active',?)`).bind(now).run();
 await db.prepare(`INSERT INTO attendee_question_answers(question_id,attendee_id,answer,updated_at) VALUES('fixture-q31','fictional-answer-holder','Fictional answer',?)`).bind(now).run();
 result.checks.push({name:'setup',accounts:2,seededSessions:0,migrations:migrations.length,providerBindings:false,queueBindings:false,passwordFiles:false});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});result.browser=browser.version();
 for(const [viewport,width,height] of [['desktop',1440,1000],['mobile',390,844]])for(const account of credentials){
  stage=`${viewport} ${account.role} login`;
  const context=await browser.newContext({viewport:{width,height},hasTouch:viewport==='mobile',isMobile:viewport==='mobile',ignoreHTTPSErrors:true,serviceWorkers:'block'});
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){result.blockedBrowserRequests.push({kind:'external',host:url.hostname});return route.abort();}if(!['GET','HEAD'].includes(req.method())){
   let allowed=url.pathname==='/api/admin/session'&&['POST','DELETE'].includes(req.method());
   if(url.pathname==='/api/organizer/business'&&req.method()==='POST'){const body=req.postDataJSON();allowed=body.action==='question_save'||(body.action==='ticket_save'&&body.priceMinor===15000);}
   if(!allowed){result.blockedBrowserRequests.push({kind:'write',path:url.pathname});return route.abort();}
  }return route.continue();});
  const page=await context.newPage();await page.addInitScript(()=>{window.__acceptanceCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__acceptanceCsp.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
  page.on('pageerror',e=>result.pageErrors.push({stage,kind:e.name}));
  const click=locator=>viewport==='mobile'?locator.tap():locator.click();
  await page.goto(origin+'/admin/login?returnTo='+encodeURIComponent('/organizer/workspace?area=overview'));
  await expect(page.getByLabel('Work email')).toBeEnabled();await page.getByLabel('Work email').fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(url=>url.pathname==='/organizer/workspace');
  stage=`${viewport} ${account.role} authenticated checks`;
  const events=await page.evaluate(async()=>{const r=await fetch('/api/organizer/business?section=events&event=all');return {status:r.status,data:await r.json()};});assert.equal(events.status,200);const slugs=events.data.events.map(x=>x.slug);assert(slugs.includes('fixture-assigned'));assert.equal(slugs.includes('fixture-owner-only'),account.role==='owner');
  const ownerApi=await page.evaluate(async()=>{const r=await fetch('/api/admin/accounts');return r.status;});assert.equal(ownerApi,account.role==='owner'?200:403);
  if(account.role==='owner'){
   await page.goto(origin+'/admin/accounts');await page.getByLabel('Find a team account').fill('Fictional owner');await click(page.getByRole('button').filter({hasText:'Fictional owner'}));await expect(page.getByRole('dialog')).toContainText('You’re signed in with this account.');await expect(page.getByRole('button',{name:'Remove from Operations'})).toHaveCount(0);await page.keyboard.press('Escape');
  }else{
   const denied=await page.evaluate(async()=>{const read=await fetch('/api/organizer/business?section=questions&event=fixture-owner-only');const write=await fetch('/api/organizer/business',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'question_save',eventSlug:'fixture-owner-only',id:'fixture-owner-q',prompt:'Forbidden change',kind:'text',status:'active',sortOrder:0,required:false,options:[]})});return {read:read.status,write:write.status};});assert([403,404].includes(denied.read));assert([403,404].includes(denied.write));result.checks.push({name:'cross-event isolation',viewport,...denied});
  }
  const slug=account.role==='owner'?'fixture-owner-only':'fixture-assigned',questionId=account.role==='owner'?'fixture-owner-q':'fixture-q1';
  const oldPrompt=(await db.prepare('SELECT prompt FROM event_questions WHERE id=?').bind(questionId).first()).prompt;
  await page.goto(origin+`/organizer/workspace?area=events&event=${slug}&view=overview`);await click(page.locator('summary').filter({hasText:/^Guest questions$/}));await page.getByLabel('Find a guest question').fill(oldPrompt);await click(page.getByRole('button',{name:`Edit ${oldPrompt}`,exact:true}));
  const edited=`Fictional ${account.role} confirmed ${viewport}`;await page.getByLabel('Question',{exact:true}).fill(edited);await click(page.getByRole('dialog').getByRole('button',{name:'Save question',exact:true}));await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal((await db.prepare('SELECT prompt FROM event_questions WHERE id=?').bind(questionId).first()).prompt,edited);
  await page.reload();await click(page.locator('summary').filter({hasText:/^Guest questions$/}));await page.getByLabel('Find a guest question').fill(edited);await expect(page.getByRole('button',{name:`Edit ${edited}`,exact:true})).toBeVisible();
  if(account.role==='organizer'){
   await page.getByLabel('Find a guest question').fill('Fictional question 31');await click(page.getByRole('button',{name:'Edit Fictional question 31',exact:true}));await page.getByLabel('Question',{exact:true}).fill('Rejected answered-question change');await click(page.getByRole('dialog').getByRole('button',{name:'Save question',exact:true}));await expect(page.getByRole('dialog')).toContainText('already has answers');await expect(page.getByLabel('Question',{exact:true})).toHaveValue('Rejected answered-question change');assert.equal((await db.prepare("SELECT prompt FROM event_questions WHERE id='fixture-q31'").first()).prompt,'Fictional question 31');await page.keyboard.press('Escape');
   await page.goto(origin+'/organizer/workspace?area=events&event=fixture-assigned&view=tickets');await click(page.getByRole('button',{name:'Edit Fictional standard',exact:true}));await page.getByLabel('Description',{exact:true}).fill(`Unsent ${viewport} draft`);await click(page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}));await click(page.getByRole('button',{name:'Edit Fictional standard',exact:true}));
   const concurrent=`Fictional concurrent description ${viewport}`;
   const saved=await page.evaluate(async description=>{const data=await (await fetch('/api/organizer/business?section=tickets&event=fixture-assigned')).json();const r=await fetch('/api/organizer/business',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data.tiers[0],action:'ticket_save',eventSlug:'fixture-assigned',description})});return r.status;},concurrent);assert.equal(saved,200);
   await page.getByLabel('Description',{exact:true}).fill(`Fictional retained draft ${viewport}`);await click(page.getByRole('dialog').getByRole('button',{name:'Save ticket grade',exact:true}));await expect(page.getByRole('dialog')).toContainText('changed by another editor');await expect(page.getByLabel('Description',{exact:true})).toHaveValue(`Fictional retained draft ${viewport}`);await click(page.getByRole('button',{name:'Reload saved grade',exact:true}));await expect(page.getByLabel('Description',{exact:true})).toHaveValue(concurrent);
   const finalDescription=`Fictional saved description ${viewport}`;await page.getByLabel('Description',{exact:true}).fill(finalDescription);await click(page.getByRole('dialog').getByRole('button',{name:'Save ticket grade',exact:true}));await expect(page.getByRole('dialog')).toHaveCount(0);const persisted=await db.prepare("SELECT description,price_minor FROM event_ticket_tiers WHERE id='fixture-tier'").first();assert.equal(persisted.description,finalDescription);assert.equal(persisted.price_minor,15000);await page.reload();await click(page.getByRole('button',{name:'Edit Fictional standard',exact:true}));await expect(page.getByLabel('Description',{exact:true})).toHaveValue(finalDescription);
  }else{await click(page.getByRole('button',{name:`Edit ${edited}`,exact:true}));}
  const accessibility=await new AxeBuilder({page}).include('.workspace-boardui').analyze();assert.deepEqual(accessibility.violations.map(x=>({id:x.id,impact:x.impact})),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,`${viewport}-${account.role}-saved.png`)});
  const csp=await page.evaluate(()=>window.__acceptanceCsp);result.csp.push(...csp.map(x=>({viewport,role:account.role,...x})));assert.deepEqual(csp,[]);
  await page.keyboard.press('Escape');const logout=await page.evaluate(async()=>{const r=await fetch('/api/admin/session',{method:'DELETE'});const check=await fetch('/api/admin/session');return {status:r.status,after:check.status};});assert.equal(logout.status,200);assert.equal(logout.after,401);
  result.checks.push({name:'real sign-in, persistence, accessibility and sign-out',viewport,role:account.role,passed:true});await context.close();
 }
 stage='final database assertions';assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_accounts').first()).n,2);const sessions=(await db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').first()).n;assert(sessions>=4);assert.equal(result.outboundAttempts,0);assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.blockedBrowserRequests,[]);
 result.checks.push({name:'application-created sessions',count:sessions});result.passed=true;
}catch(error){result.failure={stage,kind:error.name,message:stage.includes('setup')||stage.includes('login')||stage.includes('migration')?'Sensitive-stage details omitted.':secrets.reduce((message,secret)=>message.replaceAll(secret,'[redacted]'),String(error.message)).slice(0,1200)};process.exitCode=1;}
finally{
 const stopped=await Promise.allSettled([browser?.close(),runtime?.dispose()]);
 try{rmSync(isolated,{recursive:true,force:true});}finally{
  result.cleanup={databaseRemoved:!existsSync(isolated),temporaryDirectoryRemoved:!existsSync(isolated),passwordFilesCreated:false,browserClosed:stopped[0].status==='fulfilled',runtimeStopped:stopped[1].status==='fulfilled'};
  if(!result.cleanup.databaseRemoved||!result.cleanup.browserClosed||!result.cleanup.runtimeStopped){result.passed=false;process.exitCode=1;}
  for(const account of credentials)account.password='';secrets.fill('');
  writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,stage:result.failure?.stage,kind:result.failure?.kind,cleanup:result.cleanup}));
 }
}
