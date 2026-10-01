// Creates an external test-only overlay; never edits the frozen application tree.
import { readFile, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative, join } from 'node:path';
const source=await realpath(resolve(process.env.TICKETS_SOURCE ?? 'tickets-full-audit'));
const target=resolve(process.env.TARGETED_OVERLAY ?? 'full-audit-production-probe-prep/generated-overlay');
if(target===source || relative(source,target).split('/')[0] !== '..')throw new Error('Overlay must be outside frozen checkout');
const git=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
const identity={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain','--untracked-files=no')};
if(identity.tree!=='51004be28aeae024e286f50b8ddb8c76690db246'||identity.status)throw new Error('Frozen source identity mismatch');
const sha=body=>createHash('sha256').update(body).digest('hex');
const files=[
  {path:'tests/e2e/public-artwork-loading.spec.ts',before:"from '@playwright/test'",after:"from './analytics-fixture'"},
  {path:'tests/e2e/catalogue.ts',before:'from "@playwright/test"',after:'from "./analytics-fixture"'},
  {path:'tests/e2e/public-runtime-evidence.spec.ts'},
];
await mkdir(join(target,'tests'),{recursive:true});
const provenance={schema:1,createdAt:new Date().toISOString(),source:identity,scope:'Four existing production assertions per engine, unchanged except two fixture-import rewires. No application edits.',files:[]};
for(const file of files){
  const original=await readFile(join(source,file.path),'utf8');
  let overlay=original;
  if(file.before){
    if(original.split(file.before).length!==2)throw new Error('Expected exactly one import replacement');
    overlay=original.replace(file.before,file.after);
    if(overlay.replace(file.after,file.before)!==original)throw new Error('Assertion-preservation check failed');
  }
  const name=file.path.split('/').at(-1);
  await writeFile(join(target,'tests',name),overlay);
  provenance.files.push({sourcePath:file.path,originalSha256:sha(original),overlayPath:`tests/${name}`,overlaySha256:sha(overlay),onlyChange:file.before ? `${file.before} -> ${file.after}` : 'byte-identical'});
}
const fixture=`import { test as base, expect } from '@playwright/test';
// Only this exact first-party endpoint consumes the exclusion header.
// Playwright routing disables the browser HTTP cache; the separate probe contains
// an ordinary-browser unrouted control so that this cannot hide cache regressions.
export const test = base.extend<{ excludeAuditAnalytics: void }>({
  excludeAuditAnalytics: [async ({ context, baseURL }, use) => {
    if (baseURL !== 'https://tickets.becoreops.com') throw new Error('Unexpected production target');
    const endpoint = new URL('/api/analytics', baseURL).href;
    await context.route(url => url.href === endpoint, async route => {
      await route.continue({ headers: { ...route.request().headers(), 'x-becore-analytics': 'exclude' } });
    });
    await use();
  }, { auto: true }],
});
export { expect };
`;
await writeFile(join(target,'tests','analytics-fixture.ts'),fixture);
const config=`import original from ${JSON.stringify(join(source,'playwright.config.ts'))};
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...original,
  testDir: ${JSON.stringify(join(target,'tests'))},
  outputDir: ${JSON.stringify(join(target,'raw-results'))},
  workers: 1,
  retries: 0,
  reporter: [['line'], ['json', { outputFile: ${JSON.stringify(join(target,'raw-report.json'))} }]],
  use: { ...original.use, baseURL: 'https://tickets.becoreops.com', extraHTTPHeaders: {}, trace: 'off', screenshot: 'only-on-failure' },
  webServer: undefined,
});
`;
await writeFile(join(target,'playwright.config.ts'),config);
try{await symlink(join(source,'node_modules'),join(target,'node_modules'),'dir');}catch(error){if(error.code!=='EEXIST')throw error;if(await realpath(join(target,'node_modules'))!==await realpath(join(source,'node_modules')))throw new Error('Unexpected existing dependency link');}
provenance.fixtureSha256=sha(fixture);
provenance.configSha256=sha(config);
const final={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain','--untracked-files=no')};
if(JSON.stringify(identity)!==JSON.stringify(final))throw new Error('Source changed during overlay creation');
await writeFile(join(target,'overlay-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({overlay:target,testsPerProject:4,sourceUnchanged:true}));
