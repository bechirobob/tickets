import assert from "node:assert/strict";
import { appendFile, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import test from "node:test";
import { hasRequiredTicketsSpendLimits } from "../scripts/ai-gateway-policy.mjs";
import './iphone-layout-evidence.test.mjs';
import './support-email-rendering.test.mjs';
import './browser-audit-harness.test.mjs';

const workflowsDirectory = new URL("../.github/workflows/", import.meta.url);

test("Tickets automation remains scoped to the Tickets product", async () => {
  const workflowNames = (await readdir(workflowsDirectory)).filter((name) =>
    /\.ya?ml$/u.test(name),
  );
  const workflows = await Promise.all(
    workflowNames.map(async (name) => ({
      name,
      source: await readFile(new URL(name, workflowsDirectory), "utf8"),
    })),
  );

  for (const workflow of workflows) {
    assert.doesNotMatch(
      workflow.source,
      /bubble[ -]?wash|bubblewash\.co|address\.becoreops\.com|custom-domains\.chatgpt\.site/iu,
      `${workflow.name} must not operate another product or domain`,
    );
    for (const actionReference of workflow.source.matchAll(/uses:\s*([^\s#]+)/gu)) {
      const reference = actionReference[1];
      if (reference.startsWith("./") || reference.startsWith("docker://")) continue;
      assert.match(
        reference,
        /^[^@\s]+@[a-f0-9]{40}$/u,
        `${workflow.name} must pin ${reference} to an immutable commit SHA`,
      );
    }
  }
});

test("AI Gateway verification checks persisted budget semantics rather than response-generated rule ids", () => {
  const persisted = {
    id: "becore-tickets-ai",
    spend_limits: {
      enabled: true,
      rules: [
        { id: "cloudflare-rule-a", enabled: true, limitType: "cost", limit: 5, window: 86_400, technique: "sliding" },
        { id: "cloudflare-rule-b", enabled: true, limit_type: "cost", limit: 25, window: 2_592_000, technique: "sliding" },
        { id: "cloudflare-rule-c", enabled: true, limitType: "cost", limit: 1, window: 86_400, technique: "sliding", metadata: { user_id: { mode: "partition" } } },
      ],
    },
  };

  assert.equal(hasRequiredTicketsSpendLimits(persisted), true);
  assert.equal(hasRequiredTicketsSpendLimits({ ...persisted, spend_limits: { ...persisted.spend_limits, enabled: false } }), false);
  assert.equal(hasRequiredTicketsSpendLimits({
    ...persisted,
    spend_limits: {
      ...persisted.spend_limits,
      rules: persisted.spend_limits.rules.map((rule) => rule.limit === 25 ? { ...rule, limit: 250 } : rule),
    },
  }), false);
  assert.equal(hasRequiredTicketsSpendLimits({
    ...persisted,
    spend_limits: {
      ...persisted.spend_limits,
      rules: persisted.spend_limits.rules.map((rule) => rule.limit === 1 ? { ...rule, metadata: {} } : rule),
    },
  }), false);
});

test("SeeV readiness never terminates an importing production preparation process", async () => {
  const source = await readFile(new URL("../scripts/verify-seev-production-readiness.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.exit\s*\(/u);
  assert.match(source, /if \(!enabled\)/u);
  assert.match(source, /SEEV_CHECKOUT_API_KEY/u);
  assert.match(source, /SEEV_WEBHOOK_SECRET/u);
});

test("Apple Wallet refresh state follows all authoritative ticket state", async () => {
  const migration = await readFile(new URL("../drizzle/0043_apple_wallet_updates.sql", import.meta.url), "utf8");
  assert.match(migration, /apple_wallet_update_clock/u);
  assert.match(migration, /SET value=value\+1/u);
  assert.match(migration, /update_tag=\(SELECT value FROM apple_wallet_update_clock/u);
  assert.match(migration, /apple_wallet_event_refresh/u);
  assert.match(migration, /UPDATE OF `title`,`venue`,`area`,`starts_at`,`ends_at`,`event_state`,`schedule_status`,`removed_at`/u);
  assert.match(migration, /apple_wallet_ticket_refresh/u);
  assert.match(migration, /AFTER UPDATE OF `status` ON `tickets`/u);
  assert.match(migration, /apple_wallet_assignment_refresh/u);
  assert.match(migration, /apple_wallet_assignment_insert_refresh/u);
  assert.match(migration, /apple_wallet_assignment_delete_refresh/u);
  assert.match(migration, /attendee_id=OLD\.attendee_id/u);
  assert.match(migration, /apple_wallet_gate_update_refresh/u);
  assert.match(migration, /apple_wallet_gate_insert_refresh/u);
  assert.match(migration, /apple_wallet_gate_delete_refresh/u);
  assert.match(migration, /last_pushed_tag/u);
});


const candidateWorkflow = async () => load(await readFile(new URL("candidate-checks.yml", workflowsDirectory), "utf8"));
const candidateStep = (job, name) => {
  const matches = job.steps.filter((step) => step.name === name);
  assert.equal(matches.length, 1, `Required candidate step must occur once: ${name}`);
  assert.equal(matches[0]["continue-on-error"], undefined);
  return matches[0];
};

const candidateBrowsers = ["desktop-chromium", "mobile-chromium", "mobile-webkit"];
const candidateBrowserStep = (job, name, browser) => candidateStep(job, `${name} (${browser})`);

test("candidate CI runs core gates once and restores the same local build for every browser", async () => {
  const workflow = await candidateWorkflow();
  assert.deepEqual(Object.keys(workflow.jobs), ["verify"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const { verify } = workflow.jobs;
  assert.equal(verify.name, "verify");
  assert.equal(verify["runs-on"], "ubuntu-latest");
  assert.equal(verify["timeout-minutes"], 120);
  assert.equal(verify.needs, undefined);
  assert.equal(verify.if, undefined);
  assert.equal(verify["continue-on-error"], undefined);
  assert.equal(verify.strategy, undefined);
  assert.equal(verify.outputs, undefined);
  assert.equal(new Set(verify.steps.map((step) => step.name)).size, verify.steps.length);
  for (const step of verify.steps) {
    assert.equal(typeof step.name, "string", "Every gate has an explicit, unique name");
    assert.equal(step["continue-on-error"], undefined, "A failed gate must fail the job");
    assert.doesNotMatch(step.uses ?? "", /actions\/(?:upload-artifact|download-artifact|cache)@/u);
    assert.equal(step.with?.cache, undefined, "Candidate builds never depend on Actions cache storage");
  }
  const required = {
    "Verify bounded audit exception": "python3 -m unittest discover -s tests -p 'test_checkbox_hotfix_audit.py' -v",
    "Audit dependencies": "python3 scripts/audit-checkbox-hotfix.py",
    "Lint application": "npm run lint",
    "Check application types": "npm run typecheck",
    "Verify unit tests and rendered production build": "npm test",
    "Check database schema": "npx drizzle-kit check",
    "Validate the deployable Worker without publishing": "npx wrangler deploy --config dist/server/wrangler.json --dry-run --outdir dist/worker-dry-run",
  };
  for (const [name, command] of Object.entries(required)) {
    const step = candidateStep(verify, name);
    assert.equal(step.run, command);
    assert.equal(step.if, undefined);
    assert.equal(verify.steps.filter((step) => step.run === command).length, 1);
  }
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const suite of ["test:repo", "test:ui", "test:password-client", "test:rendered", "test:worker"]) {
    assert.ok(scripts.test.includes(`npm run ${suite}`));
  }
  assert.match(scripts["test:rendered"], /^npm run build && node scripts\/prepare-deploy\.mjs && node --test tests\/rendered-html\.test\.mjs$/u);
  const checkouts = verify.steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkouts.length, 1);
  assert.equal(checkouts[0].with.ref, workflow.env.BECORE_RELEASE_SHA);
  assert.equal(checkouts[0].with["persist-credentials"], false);
  assert.equal(checkouts[0].with["fetch-depth"], 0, "The bounded exception verifies exact commit ancestry");
  assert.equal(verify.steps.filter((step) => step.run === "npm ci --no-audit").length, 1);
  const source = candidateStep(verify, "Verify exact candidate source");
  const pack = candidateStep(verify, "Package verified browser build");
  const evidence = candidateStep(verify, "Verify candidate evidence transport");
  const install = candidateStep(verify, "Install browsers for event-page verification");
  for (const step of [source, pack, evidence, install]) assert.equal(step.if, undefined);
  assert.equal(source.id, "source");
  assert.equal(pack.id, "build");
  assert.equal(install.id, "browsers");
  assert.equal(install.run, "npx playwright install --with-deps chromium webkit");
  assert.equal(evidence.run, "python3 -m unittest discover -s ops/vps -p 'test_candidate_evidence.py' -v");
  assert.equal(verify.steps.filter((step) => step.run?.includes('tar -czf "$archive"')).length, 1);
  assert.ok(verify.steps.indexOf(source) < verify.steps.indexOf(pack));
  assert.ok(verify.steps.indexOf(pack) < verify.steps.indexOf(install));
  let previousBrowserEnd = verify.steps.indexOf(install);
  for (const browser of candidateBrowsers) {
    const id = browser.replaceAll("-", "_");
    const restore = candidateBrowserStep(verify, "Verify and restore the exact candidate build", browser);
    const fixtures = candidateBrowserStep(verify, "Prepare isolated event fixtures", browser);
    assert.equal(restore.id, `restore_${id}`);
    assert.equal(restore.if, "${{ !cancelled() && steps.source.outcome == 'success' && steps.build.outcome == 'success' && steps.browsers.outcome == 'success' }}");
    assert.deepEqual(restore.env, {
      BUILD_SHA: "${{ steps.source.outputs.sha }}", BUILD_TREE: "${{ steps.source.outputs.tree }}",
      BUILD_DIGEST: "${{ steps.build.outputs.sha256 }}",
    });
    assert.equal(fixtures.id, `fixtures_${id}`);
    assert.equal(fixtures.if, `\${{ !cancelled() && steps.restore_${id}.outcome == 'success' }}`);
    assert.equal(fixtures.run, "npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state");
    assert.ok(verify.steps.indexOf(restore) > previousBrowserEnd);
    assert.ok(verify.steps.indexOf(fixtures) > verify.steps.indexOf(restore));
    previousBrowserEnd = verify.steps.indexOf(candidateBrowserStep(verify, "Verify host report fixture recovery without retries", browser));
  }
});

test("candidate browser coverage retains full journeys and deliberate no-retry regressions", async () => {
  const { verify } = (await candidateWorkflow()).jobs;
  const suites = {
    "Verify optional SeevPlus checkout on desktop and mobile": ["seev", "node scripts/prepare-seev-browser-fixture.mjs", "seevplus"],
    "Verify opt-in USDC checkout without provider traffic": ["seev-crypto", "node scripts/prepare-seev-browser-fixture.mjs crypto", "seevplus-crypto"],
    "Verify RSVP and interest registration on desktop and mobile": ["registration", "node scripts/prepare-registration-browser-fixture.mjs", "registration"],
    "Verify owner Operations workflows on desktop and mobile": ["operations", "node scripts/prepare-operations-browser-fixture.mjs", "operations"],
  };
  for (const browser of candidateBrowsers) {
    const project = `--project ${browser}`;
    const condition = `\${{ !cancelled() && steps.fixtures_${browser.replaceAll("-", "_")}.outcome == 'success' }}`;
    const step = (name) => {
      const result = candidateBrowserStep(verify, name, browser);
      assert.equal(result.if, condition, "Each browser stage must run after earlier failures when its own fixtures succeeded");
      return result;
    };
    const room = step("Capture natural Room entry before the full browser suite");
    assert.equal(room.run, `npx playwright test tests/e2e/room-natural-entry.spec.ts ${project} --workers=1 --retries=0 --output test-results/room-entry`);
    const roomEvidence = step("Preserve natural Room entry evidence immediately");
    assert.equal(roomEvidence.run, `python3 ops/vps/candidate_evidence.py encode --root test-results/room-entry --stage room-entry --source-sha "$BECORE_RELEASE_SHA" --browser ${browser}`);
    const full = step("Verify every browser journey before release");
    assert.equal(full.run, `npx playwright test ${project}`);
    assert.equal(step("Verify keyboard navigation focus without retries").run,
      `npx playwright test tests/e2e/navigation-audit.spec.ts ${project} --workers=1 --retries=0 --repeat-each=3 --output test-results/navigation-focus`);
    for (const [name, [config, fixture, output]] of Object.entries(suites)) {
      const suite = step(name);
      const noRetry = config === "operations" ? " --workers=1 --retries=0" : "";
      assert.equal(suite.run.trimEnd(), `${fixture}\nnpx playwright test --config playwright.${config}.config.ts ${project}${noRetry} --output test-results/${output}`);
      assert.doesNotMatch(suite.run, /--grep/u, "The full suite must not silently narrow coverage");
    }
    const operations = step("Verify owner Operations workflows on desktop and mobile");
    const operationsEvidence = step("Preserve required Operations visual evidence immediately");
    assert.equal(operationsEvidence.run, `python3 ops/vps/candidate_evidence.py encode --root test-results/operations --stage operations --source-sha "$BECORE_RELEASE_SHA" --browser ${browser}`);
    const recovery = step("Verify host report fixture recovery without retries");
    assert.equal(recovery.run, `npx playwright test --config playwright.operations.config.ts ${project} --grep 'host lands on their event' --workers=1 --retries=0 --repeat-each=3 --output test-results/host-overview`);
    assert.equal(verify.steps.indexOf(roomEvidence), verify.steps.indexOf(room) + 1);
    assert.ok(verify.steps.indexOf(roomEvidence) < verify.steps.indexOf(full));
    assert.equal(verify.steps.indexOf(operationsEvidence), verify.steps.indexOf(operations) + 1);
    assert.ok(verify.steps.indexOf(operationsEvidence) < verify.steps.indexOf(recovery));
  }
  assert.equal(verify.steps.some((step) => step.name.startsWith("Verify organizer suite on desktop and mobile")), false);
});

test("candidate local archive preserves hidden files, isolates browsers, and fails closed on source or byte mismatches", async (t) => {
  const { verify } = (await candidateWorkflow()).jobs;
  const temporary = await mkdtemp(join(tmpdir(), "tickets-candidate-ci-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const checkout = join(temporary, "checkout");
  const runnerTemp = join(temporary, "runner");
  const output = join(temporary, "outputs");
  await mkdir(checkout);
  await mkdir(runnerTemp);
  const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  await writeFile(join(checkout, "source.txt"), "exact source\n");
  git("add", "source.txt");
  git("-c", "user.name=CI Test", "-c", "user.email=ci-test@example.invalid", "commit", "-m", "Fixture");
  const sha = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  await mkdir(join(checkout, "dist/client/.vite"), { recursive: true });
  await mkdir(join(checkout, "dist/server"), { recursive: true });
  const manifest = '{"asset":"unchanged"}\n';
  const compiled = Buffer.from([0, 1, 2, 128, 255]);
  await writeFile(join(checkout, "dist/client/.vite/manifest.json"), manifest);
  await writeFile(join(checkout, "dist/client/app.bin"), compiled);
  await writeFile(join(checkout, "dist/server/wrangler.json"), JSON.stringify({ vars: { RELEASE_SHA: sha } }));
  // All destructive shell commands operate only inside this fresh temporary repo.
  const environment = {
    ...process.env, BECORE_RELEASE_SHA: sha, RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: output,
    GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_WORKSPACE: checkout, E2E_BASE_URL: "",
  };
  const run = (step, overrides = {}) => spawnSync("bash", ["-c", step.run], {
    cwd: checkout, env: { ...environment, ...overrides }, encoding: "utf8",
  });
  const source = candidateStep(verify, "Verify exact candidate source");
  const pack = candidateStep(verify, "Package verified browser build");
  const restores = candidateBrowsers.map((browser) => candidateBrowserStep(verify, "Verify and restore the exact candidate build", browser));
  for (const step of [source, pack]) {
    const result = run(step);
    assert.equal(result.status, 0, result.stderr);
  }
  const outputs = Object.fromEntries((await readFile(output, "utf8")).trim().split("\n").map((line) => line.split("=")));
  assert.equal(outputs.sha, sha);
  assert.equal(outputs.tree, tree);
  assert.match(outputs.sha256, /^[a-f0-9]{64}$/u);
  const archive = join(runnerTemp, "candidate-build/browser-build.tar.gz");
  const archiveBytes = await readFile(archive);
  const build = { BUILD_SHA: outputs.sha, BUILD_TREE: outputs.tree, BUILD_DIGEST: outputs.sha256 };
  const preservedEvidence = join(runnerTemp, "already-logged-evidence.txt");
  const unrelatedFile = join(checkout, "outside-cleanup.txt");
  await writeFile(preservedEvidence, "previous browser evidence\n");
  await writeFile(unrelatedFile, "keep unrelated checkout files\n");
  for (const restore of restores) {
    for (const directory of [".wrangler/state", "test-results", "playwright-report", "dist/previous-browser"]) {
      await mkdir(join(checkout, directory), { recursive: true });
      await writeFile(join(checkout, directory, "previous-browser.txt"), "stale fixture state\n");
    }
    await writeFile(join(checkout, "dist/client/.vite/manifest.json"), "stale manifest\n");
    await writeFile(join(checkout, "dist/client/app.bin"), "mutated compiled bytes");
    const restored = run(restore, build);
    assert.equal(restored.status, 0, `${restore.name}: ${restored.stderr}`);
    assert.equal(await readFile(join(checkout, "dist/client/.vite/manifest.json"), "utf8"), manifest);
    assert.deepEqual(await readFile(join(checkout, "dist/client/app.bin")), compiled);
    for (const directory of [".wrangler", "test-results", "playwright-report", "dist/previous-browser"]) {
      await assert.rejects(readdir(join(checkout, directory)), { code: "ENOENT" });
    }
    assert.deepEqual(await readFile(archive), archiveBytes, "Every browser consumes the same immutable archive bytes");
    assert.equal(await readFile(preservedEvidence, "utf8"), "previous browser evidence\n");
    assert.equal(await readFile(unrelatedFile, "utf8"), "keep unrelated checkout files\n");
    await mkdir(join(checkout, ".wrangler"));
    const protectedMarker = join(checkout, ".wrangler/rejected-before-cleanup.txt");
    await writeFile(protectedMarker, "reject before deleting anything\n");
    for (const overrides of [
      { BUILD_SHA: "a".repeat(40) }, { BUILD_TREE: "b".repeat(40) },
      { BUILD_DIGEST: "c".repeat(64) }, { BUILD_DIGEST: "" },
      { BECORE_RELEASE_SHA: "d".repeat(40) }, { RUNNER_TEMP: join(temporary, "missing-archive") },
      { GITHUB_ACTIONS: "false" }, { RUNNER_ENVIRONMENT: "self-hosted" },
      { GITHUB_WORKSPACE: temporary }, { E2E_BASE_URL: "https://example.invalid" },
    ]) {
      assert.notEqual(run(restore, { ...build, ...overrides }).status, 0, `${restore.name} rejected ${JSON.stringify(overrides)}`);
      assert.equal(await readFile(protectedMarker, "utf8"), "reject before deleting anything\n");
    }
  }
  assert.notEqual(run(source, { BECORE_RELEASE_SHA: "a".repeat(40) }).status, 0);
  await writeFile(join(checkout, "source.txt"), "dirty source\n");
  for (const restore of restores) assert.notEqual(run(restore, build).status, 0, "Dirty source cannot share the original build identity");
  git("add", "source.txt");
  for (const restore of restores) assert.notEqual(run(restore, build).status, 0, "Staged source changes cannot share the original build identity");
  git("reset", "--hard", sha);
  git("-c", "user.name=CI Test", "-c", "user.email=ci-test@example.invalid", "commit", "--allow-empty", "-m", "Different HEAD");
  for (const restore of restores) assert.notEqual(run(restore, build).status, 0, "A different checked-out HEAD is rejected even if its tree matches");
  git("reset", "--hard", sha);
  // The production archive is intentionally read-only; mutate only this temp fixture.
  await chmod(archive, 0o600);
  await appendFile(archive, "tampered");
  for (const restore of restores) assert.notEqual(run(restore, build).status, 0, "Corrupt archive must not be restored");
  await writeFile(join(checkout, "dist/server/wrangler.json"), JSON.stringify({ vars: { RELEASE_SHA: "e".repeat(40) } }));
  assert.notEqual(run(pack).status, 0, "Build with a stale revision must not be packaged");
  // A digest-consistent local archive must still embed the exact checked-out SHA.
  execFileSync("tar", ["-czf", archive, "dist/client", "dist/server"], { cwd: checkout });
  const digest = execFileSync("sha256sum", [archive], { encoding: "utf8" }).split(" ")[0];
  for (const restore of restores) assert.notEqual(run(restore, { ...build, BUILD_DIGEST: digest }).status, 0,
    "A digest-consistent archive with a stale embedded release SHA is rejected");
});

test("production audit covers the deployed main revision while candidate CI covers the entire PR", async () => {
  const workflow = load(await readFile(new URL("browser-audit.yml", workflowsDirectory), "utf8"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ["Deploy to Cloudflare", "Release verified Tickets VPS code"], types: ["completed"],
  });
  const job = workflow.jobs["browser-audit"];
  assert.equal(job.if, "github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'");
  assert.deepEqual(job.strategy.matrix.browser, ["desktop-chromium", "mobile-chromium", "mobile-webkit"]);
  const resolve = candidateStep(job, "Resolve and verify the active production revision");
  assert.equal(job.steps[0], resolve, "No repository code may run before production identity is verified");
  assert.match(resolve.run, /--proto '=https' --tlsv1\.2 --connect-timeout 5 --max-time 20 --max-filesize 65536/u);
  assert.doesNotMatch(resolve.run, /--location|--insecure|curl\s+-[^\s]*[Lk]/u);
  assert.equal(resolve.run.match(/test "\$status" = 200/gu)?.length, 2);
  const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.deepEqual(checkout.with, {
    repository: "bechirobob/tickets", ref: "${{ steps.deployed.outputs.revision }}",
    "fetch-depth": 0, "persist-credentials": false,
  });
  const source = candidateStep(job, "Verify deployed source belongs to this repository main history");
  assert.ok(job.steps.indexOf(source) > job.steps.indexOf(checkout));
  assert.ok(job.steps.indexOf(source) < job.steps.findIndex((step) => step.run === "npm ci"));
  assert.match(source.run, /git merge-base --is-ancestor "\$DEPLOYED_SHA" refs\/remotes\/origin\/main/u);
  const audit = candidateStep(job, "Audit production in desktop Chrome, mobile Chrome and mobile WebKit");
  assert.equal(audit.run, "npm run test:e2e:production -- --project ${{ matrix.browser }} --workers=1 --retries=0");
  assert.equal(audit.if, undefined);
  const before = candidateStep(job, "Confirm production still matches the audited source");
  const after = candidateStep(job, "Confirm production stayed on the audited source");
  assert.ok(job.steps.indexOf(before) < job.steps.indexOf(audit));
  assert.ok(job.steps.indexOf(after) > job.steps.indexOf(audit));
  assert.equal(after.if, "${{ always() && steps.source.outcome == 'success' }}");
  for (const step of [source, before, after]) assert.equal(step.env.DEPLOYED_SHA, "${{ steps.deployed.outputs.revision }}");
  const evidence = candidateStep(job, "Preserve browser results and isolated Room renders");
  assert.equal(evidence.if, "always()");
  assert.ok(evidence.with.path.includes("${{ runner.temp }}/production-browser-audit/*.json"));
  assert.ok(evidence.with.path.includes("${{ runner.temp }}/production-browser-audit/checked-out-*.txt"));
  const candidate = await candidateWorkflow();
  assert.equal(candidate.env.BECORE_RELEASE_SHA, "${{ github.event.pull_request.head.sha || github.sha }}");
  for (const browser of candidateBrowsers) {
    assert.equal(candidateBrowserStep(candidate.jobs.verify, "Verify every browser journey before release", browser).run,
      `npx playwright test --project ${browser}`);
  }
  const config = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");
  assert.match(config, /testDir: "\.\/tests\/e2e"/u);
  assert.doesNotMatch(config, /testIgnore|testMatch|grepInvert|grep:/u);
  for (const name of ["guest-clarity.spec.ts", "mobile-app-behavior.spec.ts"]) {
    assert.ok((await readFile(new URL(`../tests/e2e/${name}`, import.meta.url), "utf8")).length > 0);
  }
});

test("production audit identity and main ancestry gates fail closed on mismatches and deployment drift", async (t) => {
  const workflow = load(await readFile(new URL("browser-audit.yml", workflowsDirectory), "utf8"));
  const job = workflow.jobs["browser-audit"];
  const resolve = candidateStep(job, "Resolve and verify the active production revision");
  const source = candidateStep(job, "Verify deployed source belongs to this repository main history");
  const temporary = await mkdtemp(join(tmpdir(), "tickets-production-audit-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const repository = join(temporary, "repository");
  const bin = join(temporary, "bin");
  const runner = join(temporary, "runner");
  for (const directory of [repository, bin, runner]) await mkdir(directory);
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("-c", "user.name=CI Test", "-c", "user.email=ci-test@example.invalid", "commit", "--allow-empty", "-m", "Deployed source");
  const revision = git("rev-parse", "HEAD");
  git("remote", "add", "origin", "https://github.com/bechirobob/tickets");
  git("update-ref", "refs/remotes/origin/main", revision);
  // Public identity responses are fixtures: this test never contacts production.
  await writeFile(join(bin, "curl"), `#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while (( $# )); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    https://tickets.becoreops.com/healthz|https://tickets.becoreops.com/api/version) url="$1"; shift ;;
    *) shift ;;
  esac
done
[[ -n "$output" && -n "$url" ]]
[[ "\${FAIL_REQUEST:-0}" = 0 ]]
if [[ "$url" = */healthz ]]; then
  cp "$FIXTURE/health.json" "$output"
  printf '%s' "\${HEALTH_STATUS:-200}"
else
  cp "$FIXTURE/version.json" "$output"
  printf '%s' "\${VERSION_STATUS:-200}"
fi
`, { mode: 0o755 });
  const environment = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: temporary,
    RUNNER_TEMP: runner, GITHUB_REPOSITORY: "bechirobob/tickets",
    GITHUB_OUTPUT: join(temporary, "output"), GITHUB_STEP_SUMMARY: join(temporary, "summary"), DEPLOYED_SHA: "",
  };
  const run = (command, overrides = {}) => spawnSync("bash", ["-c", command], {
    cwd: repository, env: { ...environment, ...overrides }, encoding: "utf8",
  });
  const health = { service: "becore-tickets", runtime: "vps", active: true, revision };
  const version = { service: "becore-tickets", revision };
  const fixture = async (healthResponse = health, versionResponse = version) => {
    await writeFile(join(temporary, "health.json"), JSON.stringify(healthResponse));
    await writeFile(join(temporary, "version.json"), JSON.stringify(versionResponse));
    await writeFile(environment.GITHUB_OUTPUT, "");
  };
  await fixture();
  let result = run(resolve.run);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(environment.GITHUB_OUTPUT, "utf8"), `revision=${revision}\n`);
  const baseline = JSON.parse(await readFile(join(runner, "production-browser-audit/baseline-resolved.json"), "utf8"));
  assert.equal(baseline.revision, revision);
  assert.equal(baseline.active, true);
  assert.equal(baseline.runtime, "vps");
  result = run(source.run, { DEPLOYED_SHA: revision });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(runner, "production-browser-audit/checked-out-revision.txt"), "utf8"), `${revision}\n`);
  for (const phase of ["before", "after"]) {
    const command = `bash "$RUNNER_TEMP/production-browser-audit/verify-deployment.sh" ${phase}`;
    assert.equal(run(command, { DEPLOYED_SHA: revision }).status, 0);
    assert.notEqual(run(command, { DEPLOYED_SHA: "b".repeat(40) }).status, 0, "Deployment drift cannot pass the audit");
    assert.notEqual(run(command).status, 0, "Rechecks require the original baseline");
  }
  for (const [healthResponse, versionResponse] of [
    [{ ...health, service: "another-service" }, version],
    [health, { ...version, service: "another-service" }],
    [{ ...health, runtime: "edge" }, version],
    [{ ...health, active: false }, version],
    [{ ...health, active: "true" }, version],
    [{ ...health, revision: "b".repeat(40) }, version],
    [{ ...health, revision: "abc123" }, { ...version, revision: "abc123" }],
    [{ ...health, revision: `${revision}\ninjected=value` }, { ...version, revision: `${revision}\ninjected=value` }],
    [health, { ...version, revision: null }],
    [[], version],
    [health, null],
  ]) {
    await fixture(healthResponse, versionResponse);
    assert.notEqual(run(resolve.run).status, 0, `Rejected invalid identity: ${JSON.stringify([healthResponse, versionResponse])}`);
    assert.equal(await readFile(environment.GITHUB_OUTPUT, "utf8"), "", "Invalid responses must not supply a checkout SHA");
  }
  await fixture();
  assert.notEqual(run(resolve.run, { FAIL_REQUEST: "1" }).status, 0, "Failed public request must stop checkout");
  for (const field of ["HEALTH_STATUS", "VERSION_STATUS"]) {
    for (const status of ["201", "301", "302", "503"]) {
      await fixture();
      assert.notEqual(run(resolve.run, { [field]: status }).status, 0, "A JSON-shaped non-200 response cannot establish a healthy baseline");
      assert.equal(await readFile(environment.GITHUB_OUTPUT, "utf8"), "");
    }
  }
  assert.notEqual(run(resolve.run, { GITHUB_REPOSITORY: "someone/else" }).status, 0);
  assert.notEqual(run(source.run, { DEPLOYED_SHA: "b".repeat(40) }).status, 0, "Checkout must equal the deployed SHA");
  assert.notEqual(run(source.run, { DEPLOYED_SHA: revision, GITHUB_REPOSITORY: "someone/else" }).status, 0);
  git("remote", "set-url", "origin", "https://github.com/someone/else");
  assert.notEqual(run(source.run, { DEPLOYED_SHA: revision }).status, 0, "An unrelated repository is rejected");
  git("remote", "set-url", "origin", "https://github.com/bechirobob/tickets.git");
  assert.equal(run(source.run, { DEPLOYED_SHA: revision }).status, 0);
  git("-c", "user.name=CI Test", "-c", "user.email=ci-test@example.invalid", "commit", "--allow-empty", "-m", "Unmerged source");
  assert.notEqual(run(source.run, { DEPLOYED_SHA: git("rev-parse", "HEAD") }).status, 0, "A matching checkout outside origin/main is rejected");
});
