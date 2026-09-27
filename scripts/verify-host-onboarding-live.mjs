import {createHash,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

// One-time owner-authorized pre-campaign smoke. Never logs contact data or tokens.
const origin='https://tickets.becoreops.com';
const api=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const headers={Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'};
function check(value,message){if(!value)throw new Error(message);}
const listed=await fetch(`${api}/d1/database?name=becore-tickets-db`,{headers});
const db=(await listed.json()).result?.find(x=>x.name==='becore-tickets-db');
check(listed.ok&&db?.uuid,'Database resolution failed');
async function query(sql,params=[]){
 const response=await fetch(`${api}/d1/database/${db.uuid}/query`,{method:'POST',headers,body:JSON.stringify({sql,params})});
 const data=await response.json();check(response.ok&&data.success&&data.result?.[0]?.success,'Database verification query failed');return data.result[0].results;
}
const release=await fetch(`${origin}/api/version`).then(r=>r.json());
check(release.revision===process.env.EXPECTED_RELEASE_SHA,'Production revision differs from expected release');
const owners=await query("SELECT normalized_email FROM staff_accounts WHERE role='owner' AND status='active'");
const owner=owners.find(x=>createHash('sha256').update(x.normalized_email).digest('hex')==='d2afa7273a4645949d3f76e8691e3c20f14bcc2470002ecc128b56731af2772d');
check(owner,'Authorized owner mailbox not found');
const email=owner.normalized_email;
check(!(await query('SELECT id FROM host_applications WHERE email=?',[email])).length,'Existing owner application preserved; choose a separate smoke mailbox');
const marker=`Internal onboarding check ${randomUUID()}`;
const evidence={revision:release.revision,checks:[],cleanup:false};
let browser,stage='public links';
try{
 for(const path of ['/organizer/join','/organizer/join/confirm','/hosts/kofi-bills','/terms','/privacy','/brand/becore-ticket.png?v=5']){
  const r=await fetch(origin+path,{headers:{'x-becore-analytics':'exclude'}});check(r.ok,`Public link failed: ${path}`);evidence.checks.push(`HTTP ${r.status}: ${path}`);
 }
 const unauthorized=await fetch(origin+'/api/admin/host-applications');check(unauthorized.status===403,'Owner queue must require authentication');
 stage='mobile browser form';
 browser=await chromium.launch({channel:'chromium'});
 const page=await browser.newPage({viewport:{width:390,height:844},extraHTTPHeaders:{'x-becore-analytics':'exclude'}});
 await page.goto(origin+'/organizer/join');
 await expect(page.getByRole('heading',{name:/You bring the people/})).toBeVisible();
 await mkdir('host-live-evidence',{recursive:true});
 await page.screenshot({path:'host-live-evidence/form-mobile.png',fullPage:true});
 await page.getByLabel('Host or brand name').fill(marker);
 await page.getByLabel('Your name',{exact:true}).fill('Internal verification');
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Phone / WhatsApp').fill('+233200000000');
 await page.getByLabel('Social page or website').fill(origin);
 await page.getByLabel('What’s your kind of gathering?').fill('Owner-authorized live verification; remove this test record after checking.');
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Let’s get you verified'}).click();
 await expect(page.getByRole('heading',{name:'One quick inbox check.'})).toBeVisible({timeout:30000});
 stage='persisted application and provider receipt';
 const row=(await query('SELECT * FROM host_applications WHERE email=? AND brand_name=?',[email,marker]))[0];
 check(row?.status==='awaiting_email'&&row.contact_name==='Internal verification'&&row.phone==='+233200000000'&&row.social_url===origin+'/'&&row.accepted_at&&JSON.parse(row.policy_versions).length,'Live form did not persist all consent and contact data');
 evidence.checks.push('Actual mobile form button persisted all fields and consent');
 const delivery=(await query("SELECT id,status,provider_id,payload_json FROM delivery_events WHERE kind='host_application_verify' AND recovery_grant_id=?",[row.verification_hash]))[0];
 check(['sent','delivered'].includes(delivery?.status)&&delivery.provider_id,'Confirmation email was not accepted by the mail provider');
 evidence.checks.push('Confirmation email accepted by provider');
 const token=JSON.parse(delivery.payload_json).text.match(/#token=([\w-]{43})/)?.[1];check(token,'Confirmation link missing');
 stage='email confirmation';
 await page.goto(origin+'/organizer/join/confirm#token='+token);
 await expect(page.getByRole('button',{name:'Confirm my email'})).toBeVisible();
 check(!new URL(page.url()).hash,'Confirmation token remained in browser history');
 await page.getByRole('button',{name:'Confirm my email'}).click();
 await expect(page.getByRole('heading',{name:'Your host application is in.'})).toBeVisible();
 const pending=(await query("SELECT id,status,email_verified_at,account_id,host_id FROM host_applications WHERE id=? AND status='pending'",[row.id]))[0];
 check(pending?.email_verified_at&&!pending.account_id&&!pending.host_id,'Application did not reach owner approval queue without automatic access');
 evidence.checks.push('Actual email-confirmation button moved record into pending owner queue');
 await page.screenshot({path:'host-live-evidence/confirmation-mobile.png',fullPage:true});
 console.log('Live form, delivery, confirmation, links and pending approval persistence verified.');
}catch{
 // Playwright error call logs can contain entered contact details or token URLs.
 console.error(`Live onboarding smoke failed at: ${stage}. Private values omitted.`);
 process.exitCode=1;
}finally{
 await browser?.close();
 // Only this unique smoke record is removable. Never touch an existing application.
 const own=(await query('SELECT id,verification_hash FROM host_applications WHERE email=? AND brand_name=?',[email,marker]))[0];
 if(own){
  await query("DELETE FROM delivery_events WHERE kind='host_application_verify' AND recovery_grant_id=? AND recipient=?",[own.verification_hash,email]);
  await query('DELETE FROM host_applications WHERE id=? AND email=? AND brand_name=?',[own.id,email,marker]);
 }
 evidence.cleanup=!(await query('SELECT id FROM host_applications WHERE email=? AND brand_name=?',[email,marker])).length;
 await writeFile('host-live-evidence.json',JSON.stringify(evidence,null,2));
 console.log(evidence.cleanup?'Isolated smoke data removed.':'Smoke cleanup failed.');
 check(evidence.cleanup,'Smoke data remains');
}
