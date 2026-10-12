import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const requireDependency=createRequire(import.meta.url);
function renderMoney(financialScope){
 return readFile(new URL('../app/organizer/workspace/suite-records.tsx',import.meta.url),'utf8').then(source=>{
  const compiled=transformSync(source,{loader:'tsx',jsx:'automatic',format:'cjs'}),componentModule={exports:{}};
  const require=specifier=>{
   if(specifier==='./suite-shared')return {
    useRemote:()=>({data:{financialScope,totals:{collectedMinor:611,feesMinor:49,refundsMinor:208,faceMinor:611,ticketRefundsMinor:208},payoutTotals:{paidMinor:100},statements:[{id:'s',eventTitle:'My event',periodEnd:'2026-10-12',grossMinor:611,feesMinor:49,refundsMinor:225,netMinor:386,status:'ready'}],transfers:[]}}),
    RemoteState:()=>null,apiUrl:()=>'/export',money:value=>`GHS ${value}`,date:value=>value,readable:value=>value,
   };
   if(specifier.startsWith('../../'))return {__esModule:true,default:()=>null};
   return requireDependency(specifier);
  };
  runInNewContext(compiled.code,{module:componentModule,exports:componentModule.exports,require});
  return renderToStaticMarkup(createElement(componentModule.exports.Money,{event:'mine'}));
 });
}
test('host money renders ticket accounting and payout status without platform fee widgets even if extra fields arrive',async()=>{
 const html=await renderMoney('tickets');
 assert.doesNotMatch(html,/Booking fees|<th>Fees<\/th>|GHS 49/u);
 assert.match(html,/Ticket sales/u);assert.match(html,/Ticket refunds/u);
 assert.match(html,/GHS 386/u);assert.match(html,/Paid out/u);
});
test('owner money retains booking fees and statement fee columns',async()=>{
 const html=await renderMoney('platform');
 assert.match(html,/Booking fees/u);assert.match(html,/<th>Fees<\/th>/u);assert.match(html,/GHS 49/u);
});

async function renderAnalytics(financialScope){
 const source=await readFile(new URL('../app/organizer/analytics/organizer-analytics.tsx',import.meta.url),'utf8');
 const compiled=transformSync(source,{loader:'tsx',jsx:'automatic',format:'cjs'}),componentModule={exports:{}};
 const data={financialScope,generatedAt:'2026-10-12T12:00:00Z',events:[{slug:'mine',title:'My event'}],scope:{label:'My event',rangeLabel:'All time',eventSlug:'mine'},overview:{paidOrders:1,faceValueMinor:10000,revenueMinor:10000,bookingFeesMinor:987600,refundsMinor:1000,averageOrderValueMinor:10000,admissions:1,checkedIn:0},comparison:null,rsvp:{totals:{confirmedGuests:0,checkedIn:0}},salesTrend:[],journeyTrend:[],ticketTiers:[],paymentMethods:[],promoters:[],checkIns:[],vipUsage:[]};
 const states=['mine','all','sales',data.events,data,false,'',false,0];let state=0;
 const require=specifier=>{
  if(specifier==='react')return {...requireDependency('react'),useState:()=>[states[state++],()=>{}],useEffect:()=>{},useMemo:fn=>fn()};
  if(specifier==='next/navigation')return {useRouter:()=>({})};
  if(specifier.includes('analytics-period'))return {percentageChange:()=>null};
  if(specifier.startsWith('.')||specifier==='next/link')return {__esModule:true,default:()=>null};
  return requireDependency(specifier);
 };
 runInNewContext(compiled.code,{module:componentModule,exports:componentModule.exports,require,URLSearchParams});
 return renderToStaticMarkup(createElement(componentModule.exports.default,{actor:'Host',role:financialScope==='platform'?'owner':'organizer',embedded:true,initialView:'sales'}));
}
test('host analytics never renders owner fee detail while owner analytics retains it',async()=>{
 const host=await renderAnalytics('tickets'),owner=await renderAnalytics('platform');
 assert.doesNotMatch(host,/Booking fees collected|9,876/u);
 assert.match(host,/Ticket sales &amp; refunds/u);assert.match(host,/Average ticket value per order/u);
 assert.match(owner,/Booking fees collected/u);assert.match(owner,/9,876/u);
});
