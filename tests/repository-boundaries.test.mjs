import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import test from "node:test";
import { hasRequiredTicketsSpendLimits } from "../scripts/ai-gateway-policy.mjs";

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

test("candidate CI runs the core gates once and fans the same build out to all browsers", async () => {
  const workflow = await candidateWorkflow();
  assert.deepEqual(Object.keys(workflow.jobs), ["core", "verify"]);
  const { core, verify } = workflow.jobs;
  assert.equal(verify.needs, "core");
  assert.equal(core.if, undefined);
  assert.equal(verify.if, undefined);
  assert.equal(core["continue-on-error"], undefined);
  assert.equal(verify["continue-on-error"], undefined);
  assert.equal(verify.strategy["fail-fast"], false);
  assert.deepEqual(verify.strategy.matrix.browser, ["desktop-chromium", "mobile-chromium", "mobile-webkit"]);
  const required = {
    "Audit dependencies": "npm audit --audit-level=moderate",
    "Lint application": "npm run lint",
    "Check application types": "npm run typecheck",
    "Verify unit tests and rendered production build": "npm test",
    "Check database schema": "npx drizzle-kit check",
    "Validate the deployable Worker without publishing": "npx wrangler deploy --config dist/server/wrangler.json --dry-run --outdir dist/worker-dry-run",
  };
  for (const [name, command] of Object.entries(required)) {
    const step = candidateStep(core, name);
    assert.equal(step.run, command);
    assert.equal(step.if, undefined);
    assert.equal(core.steps.filter((step) => step.run === command).length, 1);
    assert.equal(verify.steps.filter((step) => step.run === command).length, 0);
  }
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const suite of ["test:repo", "test:ui", "test:password-client", "test:rendered", "test:worker"]) {
    assert.ok(scripts.test.includes(`npm run ${suite}`));
  }
  assert.match(scripts["test:rendered"], /^npm run build && node scripts\/prepare-deploy\.mjs && node --test tests\/rendered-html\.test\.mjs$/u);
  for (const job of [core, verify]) {
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, workflow.env.BECORE_RELEASE_SHA);
    assert.equal(checkout.with["persist-credentials"], false);
    assert.equal(job.steps.filter((step) => step.run === "npm ci --no-audit").length, 1);
  }
  const upload = candidateStep(core, "Preserve verified browser build");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.if, undefined);
  assert.equal(core.outputs.artifact_id, "${{ steps.artifact.outputs.artifact-id }}");
  const download = candidateStep(verify, "Download the verified browser build");
  assert.deepEqual(download.with, {
    "artifact-ids": "${{ needs.core.outputs.artifact_id }}",
    path: "${{ runner.temp }}/candidate-build",
  });
  candidateStep(verify, "Verify and restore the exact candidate build");
});

test("candidate browser coverage retains full journeys and deliberate no-retry regressions", async () => {
  const { verify } = (await candidateWorkflow()).jobs;
  const project = "--project ${{ matrix.browser }}";
  assert.equal(candidateStep(verify, "Verify every browser journey before release").run, `npx playwright test ${project}`);
  const suites = {
    "Verify optional SeevPlus checkout on desktop and mobile": ["seev", "node scripts/prepare-seev-browser-fixture.mjs"],
    "Verify opt-in USDC checkout without provider traffic": ["seev-crypto", "node scripts/prepare-seev-browser-fixture.mjs crypto"],
    "Verify RSVP and interest registration on desktop and mobile": ["registration", "node scripts/prepare-registration-browser-fixture.mjs"],
    "Verify owner Operations workflows on desktop and mobile": ["operations", "node scripts/prepare-operations-browser-fixture.mjs"],
  };
  for (const [name, [config, fixture]] of Object.entries(suites)) {
    const step = candidateStep(verify, name);
    assert.ok(step.run.startsWith(`${fixture}\n`));
    assert.ok(step.run.includes(`npx playwright test --config playwright.${config}.config.ts ${project}`));
    assert.doesNotMatch(step.run, /--grep/u, "The full suite must not silently narrow coverage");
    assert.equal(step.if, "${{ !cancelled() && steps.browser_fixtures.outcome == 'success' }}");
  }
  assert.match(candidateStep(verify, "Verify owner Operations workflows on desktop and mobile").run, /--workers=1 --retries=0/u);
  assert.equal(verify.steps.some((step) => step.name === "Verify organizer suite on desktop and mobile"), false);
  for (const name of ["Verify keyboard navigation focus without retries", "Verify host report fixture recovery without retries"]) {
    assert.match(candidateStep(verify, name).run, /--workers=1 --retries=0 --repeat-each=3/u);
  }
  assert.equal(candidateStep(verify, "Preserve event-page renders and browser results").if, "always()");
  assert.equal(candidateStep(verify, "Preserve focused checkout evidence").if, "always()");
});

test("candidate artifact scripts preserve hidden build files and fail closed on source or byte mismatches", async (t) => {
  const { core, verify } = (await candidateWorkflow()).jobs;
  const temporary = await mkdtemp(join(tmpdir(), "tickets-candidate-ci-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const producer = join(temporary, "producer");
  const consumer = join(temporary, "consumer");
  const runnerTemp = join(temporary, "runner");
  const output = join(temporary, "outputs");
  await mkdir(producer);
  await mkdir(runnerTemp);
  const git = (...args) => execFileSync("git", args, { cwd: producer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  await writeFile(join(producer, "source.txt"), "exact source\n");
  git("add", "source.txt");
  git("-c", "user.name=CI Test", "-c", "user.email=ci-test@example.invalid", "commit", "-m", "Fixture");
  const sha = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  await cp(producer, consumer, { recursive: true });
  await mkdir(join(producer, "dist/client/.vite"), { recursive: true });
  await mkdir(join(producer, "dist/server"), { recursive: true });
  await writeFile(join(producer, "dist/client/.vite/manifest.json"), '{"asset":"unchanged"}\n');
  await writeFile(join(producer, "dist/server/wrangler.json"), JSON.stringify({ vars: { RELEASE_SHA: sha } }));
  const environment = { ...process.env, BECORE_RELEASE_SHA: sha, RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: output };
  const run = (step, cwd, overrides = {}) => spawnSync("bash", ["-c", step.run], {
    cwd, env: { ...environment, ...overrides }, encoding: "utf8",
  });
  const source = candidateStep(core, "Verify exact candidate source");
  const pack = candidateStep(core, "Package verified browser build");
  const restore = candidateStep(verify, "Verify and restore the exact candidate build");
  for (const step of [source, pack]) {
    const result = run(step, producer);
    assert.equal(result.status, 0, result.stderr);
  }
  const outputs = Object.fromEntries((await readFile(output, "utf8")).trim().split("\n").map((line) => line.split("=")));
  assert.equal(outputs.sha, sha);
  assert.equal(outputs.tree, tree);
  assert.match(outputs.sha256, /^[a-f0-9]{64}$/u);
  const build = { BUILD_SHA: outputs.sha, BUILD_TREE: outputs.tree, BUILD_DIGEST: outputs.sha256 };
  const restored = run(restore, consumer, build);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(await readFile(join(consumer, "dist/client/.vite/manifest.json"), "utf8"), '{"asset":"unchanged"}\n');
  for (const overrides of [
    { BUILD_SHA: "a".repeat(40) }, { BUILD_TREE: "b".repeat(40) },
    { BUILD_DIGEST: "c".repeat(64) }, { BUILD_DIGEST: "" },
    { BECORE_RELEASE_SHA: "d".repeat(40) },
  ]) {
    assert.notEqual(run(restore, consumer, { ...build, ...overrides }).status, 0, `Rejected ${JSON.stringify(overrides)}`);
  }
  assert.notEqual(run(source, producer, { BECORE_RELEASE_SHA: "a".repeat(40) }).status, 0);
  await appendFile(join(runnerTemp, "candidate-build/browser-build.tar.gz"), "tampered");
  assert.notEqual(run(restore, consumer, build).status, 0, "Corrupt archive must not be restored");
  await writeFile(join(producer, "dist/server/wrangler.json"), JSON.stringify({ vars: { RELEASE_SHA: "e".repeat(40) } }));
  assert.notEqual(run(pack, producer).status, 0, "Build with a stale revision must not be published");
  // Even a digest-consistent artifact must identify the exact checked-out SHA.
  const archive = join(runnerTemp, "candidate-build/browser-build.tar.gz");
  execFileSync("tar", ["-czf", archive, "dist/client", "dist/server"], { cwd: producer });
  const digest = execFileSync("sha256sum", [archive], { encoding: "utf8" }).split(" ")[0];
  assert.notEqual(run(restore, consumer, { ...build, BUILD_DIGEST: digest }).status, 0);
});
