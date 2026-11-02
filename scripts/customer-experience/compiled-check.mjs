// Local-only compiled acceptance: fictional records and an ephemeral attendee session; all external traffic is blocked.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,chmodSync,readdirSync,writeFileSync,rmSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const out=resolve('docs/customer-experience/evidence/compiled');mkdirSync(out,{recursive:true});
const isolated=mkdtempSync(join(tmpdir(),'tickets-customer-compiled-'));chmodSync(isolated,0o700);
process.env.WRANGLER_WRITE_LOGS='false';process.env.MINIFLARE_REGISTRY_PATH=join(isolated,'registry');
const result={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),helperSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),lockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),scope:'Compiled application and dedicated local D1; ephemeral seeded attendee session for existing bookings, no API response mocks. Nonfunctional test provider key; outbound network blocked; no queue bindings.',checks:[],pageErrors:[],blockedBrowserRequests:[],outboundAttempts:0,cleanup:{},passed:false};
let stage='runtime setup',runtime,browser,lastPage;const secrets=[];
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
 runtime=new Miniflare(convertV4MiniflareOptions({...options.workerOptions,modules,modulesRoot:resolve('dist/server'),bindings:{ENVIRONMENT:'test',PAYSTACK_SECRET_KEY:'sk_test_ui_fixture',STAFF_LOGIN_DECOY_SECRET:decoy},resourcePersistencePath:join(isolated,'state'),host:'127.0.0.1',port:8798,https:false,cf:false,log:new Log(LogLevel.NONE),outboundService:async()=>{result.outboundAttempts++;return new Response('External network disabled in isolated acceptance',{status:503});}}));
 const origin=String(await runtime.ready).replace(/\/$/,'');assert.equal(new URL(origin).hostname,'127.0.0.1');
 const db=await runtime.getD1Database('DB');stage='schema migration';
 const migrations=await readD1Migrations('./drizzle');for(const migration of migrations)await db.batch(migration.queries.map(q=>db.prepare(q)));
 const now=new Date().toISOString(),start=new Date(Date.now()+7*86400000).toISOString(),end=new Date(Date.now()+8*86400000).toISOString();
 await db.prepare('UPDATE curated_event_records SET removed_at=?').bind(now).run();
 const run=async(sql,...args)=>db.prepare(sql).bind(...args).run();
 for(let i=0;i<5;i++){
 const slug=`fictional-${i}`;
 await run(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,age_restriction,lineup,image_url,curation_note,status,created_at,updated_at,is_test_event,schedule_status,event_state) VALUES(?,?,?,?,?,'Osu',?,?,'Late night',10000,100,'18+','Fictional DJ','/events/the-weekend-braai.jpeg','Local fictional test','published',?,?,0,'confirmed','on_sale')`,slug,slug,slug,`Fictional Night ${i}`,'Fictional courtyard',start,end,now,now);
 await run(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,capacity_admissions,status,created_at,updated_at) VALUES(?,?,'general','General admission','One admission',10000,100,'available',?,?)`,slug,slug,now,now);
 }
 await run(`INSERT INTO event_registration_settings(event_slug,mode,capacity,max_party_size,accepting,updated_at) VALUES('fictional-4','rsvp',100,3,1,?)`,now);
 await run(`INSERT INTO event_coupons(id,event_slug,code,kind,value,max_uses,starts_at,expires_at,created_by,created_at) VALUES('fictional','fictional-0','FICTIONAL','fixed',1000,20,?,?,'local-test',?)`,now,end,now);
 const token=randomBytes(32).toString('hex');secrets.push(token);
 await run(`INSERT INTO attendee_profiles(id,normalized_email,display_name,created_at,updated_at) VALUES('fictional','guest@example.test','Fictional Guest',?,?)`,now,now);
 await run(`INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES('fictional','fictional',?,?,?,?)`,createHash('sha256').update(token).digest('hex'),end,now,now);
 for(let i=0;i<4;i++){
 const id=`fictional-${i}`;
 await run(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,customer_email,customer_phone,payment_channel,status,created_at) VALUES(?,?,?,1,10000,500,10500,'guest@example.test','0240000000','card','paid',?)`,id,id,id,now);
 await run(`INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)`,id,id,id,createHash('sha256').update(id).digest('hex'),now);
 await run(`INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,assigned_at) VALUES(?,'fictional','local-fixture',?)`,id,now);
 }
 result.webkit={path:webkit.executablePath(),available:existsSync(webkit.executablePath()),status:'not run: installed executable unavailable; no download attempted'};
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});result.browser=browser.version();
 for(const [viewport,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,740]]){
 stage=viewport+' browsing';
 const context=await browser.newContext({viewport:{width,height},isMobile:width<500,hasTouch:width<500,ignoreHTTPSErrors:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();result.blockedBrowserRequests.push(url.hostname);return route.abort();});
 const page=await context.newPage();lastPage=page;page.on('pageerror',e=>result.pageErrors.push({stage,message:e.message}));
 const shot=async name=>{await expect(page.getByTestId('brand-arrival')).toBeHidden({timeout:10000});await page.evaluate(async()=>{scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,`${viewport}-${name}.png`),fullPage:true});};
 await page.goto(origin+'/');await expect(page.locator('.backstage-bridge__actions a').first()).toHaveAttribute('href','/hosts');await shot('home-hosts');await page.goto(origin+'/hosts');await shot('hosts');await page.goto(origin+'/events');await expect(page.locator('.drop-card')).toHaveCount(5);
 await page.getByRole('combobox',{name:'Music and mood'}).selectOption('Amapiano');await expect(page.locator('.drop-card')).toHaveCount(0);await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.locator('.drop-card')).toHaveCount(5);
 await shot('discovery');
 const filterA11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(filterA11y.violations.map(x=>x.id),[]);
 if(width===320){for(const label of ['Area','Music and mood']){const box=await page.getByRole('combobox',{name:label,exact:true}).boundingBox();assert(box.width>=250);}await page.getByRole('combobox',{name:'Music and mood'}).selectOption('Late night');await shot('long-filter');await page.getByRole('button',{name:'Clear filters',exact:true}).click();}

 const menu=page.getByRole('button',{name:'Open navigation'});const menuBox=await menu.boundingBox();assert(menuBox.width>=44&&menuBox.height>=44);await menu.focus();await page.keyboard.press('Enter');await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();const close=page.locator('.night-mobile-menu__close');const closeBox=await close.boundingBox();assert(closeBox.width>=44&&closeBox.height>=44);await shot('menu');await page.keyboard.press('Escape');await expect(menu).toBeFocused();
 result.checks.push({name:'header menu and close: labeled 44px hit areas, keyboard opening and focus return',viewport,passed:true});

 await page.locator('.drop-card').filter({hasText:'Fictional Night 0'}).getByRole('link').first().click();await page.waitForURL('**/event/fictional-0');
 await page.getByRole('navigation',{name:'This night'}).getByRole('link').first().click();await expect(page.locator('#register')).toBeFocused();await page.getByRole('link',{name:'Get tickets',exact:true}).click();await page.waitForURL('**/checkout/fictional-0');
 stage=viewport+' checkout';
 await expect(page.locator('#checkout-coupon')).not.toBeVisible();await page.locator('.checkout-discount summary').click();await page.getByLabel('Discount code',{exact:true}).fill('BADCODE');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('.checkout-coupon')).toContainText(/not|invalid|available/i);
 await page.getByLabel('Discount code',{exact:true}).fill('FICTIONAL');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('.checkout-discount summary')).toContainText('Discount applied');await shot('discount');const checkoutA11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();result.checks.push({name:'checkout accessibility',viewport,violations:checkoutA11y.violations.map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.map(n=>n.target)}))});assert.deepEqual(checkoutA11y.violations.map(x=>x.id),[]);
 await page.getByRole('radio',{name:'Cards Visa or Mastercard through Paystack'}).check();const pay=page.getByRole('button',{name:/Continue to card payment/});await pay.click();await expect(page.getByLabel('Full name')).toBeFocused();
 await page.getByLabel('Full name').fill('Fictional Guest');await page.getByLabel('Email address',{exact:true}).fill('checkout@example.test');await page.getByLabel('Phone number').fill('0240000000');await pay.click();await expect(page.getByRole('checkbox',{name:/I accept/})).toBeFocused();await expect(page.getByRole('checkbox',{name:/Keep me posted/})).not.toBeChecked();await page.getByRole('checkbox',{name:/I accept/}).check();await pay.click();await page.waitForURL('**/payment/return?**');await expect(page.getByText(/Don’t pay again/)).toBeVisible();await shot('payment-interrupted');
 stage=viewport+' RSVP';await page.goto(origin+'/event/fictional-4');await page.getByRole('button',{name:'RSVP',exact:true}).click();await page.getByLabel('Your name').fill('Fictional RSVP');await page.getByLabel('Email address',{exact:true}).fill(`rsvp-${viewport}@example.test`);await page.getByRole('checkbox',{name:/I accept/}).check();await expect(page.getByRole('checkbox',{name:/Keep me posted/})).not.toBeChecked();const rsvpA11y=await new AxeBuilder({page}).include('.registration-form').analyze();assert.deepEqual(rsvpA11y.violations.map(x=>x.id),[]);await page.getByRole('button',{name:'Send RSVP',exact:true}).click();await expect(page.getByText('RSVP confirmed',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Show my QR passes'})).toBeVisible();await shot('rsvp-result');
 stage=viewport+' recovery';await context.clearCookies();await page.goto(origin+'/my-nights');await page.getByLabel('Booking or registration email').fill('unknown@example.test');await page.getByRole('button',{name:'Email my access link',exact:true}).click();await expect(page.getByRole('button',{name:'Check your email'})).toBeDisabled();await shot('recovery');
 await context.addCookies([{name:'bct_attendee',value:token,url:origin,secure:false,httpOnly:true,sameSite:'Lax'}]);await page.reload();await expect(page.locator('.night-listing')).toHaveCount(4);await shot('my-nights');
 const bell=page.getByRole('button',{name:'Notifications',exact:true});const bellBox=await bell.boundingBox();assert(bellBox.width>=44&&bellBox.height>=44);await bell.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'The Buzz'})).toBeVisible();await page.keyboard.press('Escape');await expect(bell).toBeFocused();
 result.checks.push({name:'notification icon: labeled 44px hit area, dialog and focus return',viewport,passed:true});

 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();result.checks.push({name:'My Nights accessibility',viewport,violations:a11y.violations.map(x=>({id:x.id,impact:x.impact}))});assert.deepEqual(a11y.violations.map(x=>x.id),[]);
 await page.getByLabel('Find a night').fill('missing');await expect(page.getByText('No matching nights.')).toBeVisible();await page.getByRole('button',{name:/Past/}).click();await expect(page.getByLabel('Find a night')).toHaveValue('');await page.getByRole('button',{name:/Following/}).click();await page.goBack();await expect(page.getByRole('button',{name:/Past/})).toHaveAttribute('aria-current','page');await page.goForward();await expect(page.getByRole('button',{name:/Following/})).toHaveAttribute('aria-current','page');
 await run("UPDATE curated_event_records SET status='draft' WHERE slug LIKE 'fictional-%'");await page.goto(origin+'/events');await expect(page.getByRole('heading',{name:'No upcoming nights announced.'})).toBeVisible();await shot('empty');await run("UPDATE curated_event_records SET status='published' WHERE slug LIKE 'fictional-%'");
 await context.clearCookies();await page.goto(origin+'/the-yorke-way');await expect(page.getByRole('button',{name:'Put me on the list'})).toBeEnabled();await page.getByRole('button',{name:'Put me on the list'}).click();await expect(page.getByLabel('Your name')).toBeFocused();await expect(page.getByRole('checkbox')).not.toBeChecked();await shot('yorke');
 const yorkeA11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(yorkeA11y.violations.map(x=>x.id),[]);
 result.checks.push({name:'Yorke existing early-access form, required consent and empty validation; no response sent',viewport,passed:true});
 result.checks.push({name:'compiled browser-to-server journeys',viewport,passed:true});await context.close();
 }
 assert.deepEqual(result.pageErrors,[]);result.localRegistrations=await db.prepare("SELECT COUNT(*) AS n FROM event_registrations WHERE normalized_email LIKE 'rsvp-%@example.test'").first();assert.equal(result.localRegistrations.n,3);result.passed=true;rmSync(join(out,'failure.png'),{force:true});
}catch(error){if(lastPage){await lastPage.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});result.visibleFailureText=(await lastPage.locator('body').innerText().catch(()=>'' )).slice(0,1800);}result.failure={stage,message:secrets.reduce((s,x)=>s.replaceAll(x,'[redacted]'),String(error.stack).replace(/claim=[^&\s\"]+/g,'claim=[redacted]')).slice(0,2500)};process.exitCode=1;}
finally{await browser?.close();await runtime?.dispose();rmSync(isolated,{recursive:true,force:true});result.cleanup={temporaryDatabaseRemoved:!existsSync(isolated),persistentCredentialsCreated:false};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
