// Verify the compiled application's unauthenticated boundaries. No identity/session is invented.
import assert from 'node:assert/strict';
import {readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
process.env.WRANGLER_WRITE_LOGS='false';
process.env.MINIFLARE_REGISTRY_PATH=resolve('.wrangler/integration-guards');
const {unstable_getMiniflareWorkerOptions}=await import('wrangler');
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const config=resolve('dist/server/integration-guards.json');
writeFileSync(config,JSON.stringify({name:'tickets-integration-guards',main:'./index.js',compatibility_date:'2026-08-11',compatibility_flags:['nodejs_compat'],assets:{directory:'../client'},vars:{ENVIRONMENT:'test'}}));
const options=unstable_getMiniflareWorkerOptions(config);delete options.workerOptions.modulesRules;
const modules=[{type:'ESModule',path:options.main},...readdirSync('dist/server',{recursive:true}).filter(path=>/\.m?js$/u.test(path)&&path!=='index.js').map(path=>({type:'ESModule',path:resolve('dist/server',path)}))];
const runtime=new Miniflare(convertV4MiniflareOptions({...options.workerOptions,modules,modulesRoot:resolve('dist/server'),host:'127.0.0.1',port:8796,cf:false}));
const evidence=[];
try{await runtime.ready;
 for(const path of ['/admin','/admin/accounts','/admin/support','/admin/promoters','/admin/hosts','/admin/account','/admin/orders','/admin/events','/admin/yorkeway-audience','/organizer/workspace?area=money','/organizer/workspace?area=team']){
  const response=await fetch(`http://127.0.0.1:8796${path}`,{redirect:'manual'}),location=response.headers.get('location');assert([302,303,307,308].includes(response.status));assert(location?.includes('/admin/login'));evidence.push({path,status:response.status,location});
 }
 for(const path of ['/api/admin/accounts','/api/admin/support','/api/admin/promoters','/api/admin/host-applications','/api/admin/passkeys','/api/admin/submissions','/api/admin/orders','/api/admin/events','/api/admin/yorkeway-audience','/api/organizer/business?section=money&event=all']){
  const response=await fetch(`http://127.0.0.1:8796${path}`);assert([401,403].includes(response.status));evidence.push({path,status:response.status});
 }
 writeFileSync(`${process.env.BOARDUI_EVIDENCE_DIR??'docs/boardui-integration/evidence/phase2'}/compiled-guards.json`,JSON.stringify({checks:evidence,authenticated:false,databaseFixture:false,productionBindings:false},null,2));
 console.log('Compiled protected pages and APIs reject unauthenticated access.');
}finally{await runtime.dispose();}
