import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.env.TARGETED_OVERLAY),out=resolve(process.env.PROBE_OUT);
await mkdir(out,{recursive:true});
const report=JSON.parse(await readFile(resolve(dir,'raw-report.json'),'utf8'));
const results=[];
function visit(suites){for(const s of suites??[]){for(const spec of s.specs??[])for(const test of spec.tests??[]){const r=test.results?.at(-1);results.push({title:spec.title.slice(0,200),project:test.projectName,status:r?.status??'missing',retry:r?.retry??null,durationMs:r?.duration??null});}visit(s.suites);}}
visit(report.suites);
if(results.length!==4)throw Error('Expected exactly four selected public tests');
const expected='473bbf40afe1a77a722c8399f91c4dd95f3e40ce';
await writeFile(resolve(out,'targeted-summary.json'),JSON.stringify({applicationSource:expected,originalProductionRun:36933434401,testCount:results.length,results,rawTracesUploaded:false,privatePagesRequested:false,assertionsUnchanged:true},null,2));
await copyFile(resolve(dir,'overlay-provenance.json'),resolve(out,'overlay-provenance.json'));
console.log(JSON.stringify({selectedTests:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status!=='passed').length,rawTracesUploaded:false}));
