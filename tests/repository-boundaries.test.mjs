import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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

test("Apple Wallet refresh state follows events, tickets, and attendee assignments", async () => {
  const migration = await readFile(new URL("../drizzle/0043_apple_wallet_updates.sql", import.meta.url), "utf8");
  assert.match(migration, /apple_wallet_event_refresh/u);
  assert.match(migration, /UPDATE OF `title`,`venue`,`area`,`starts_at`,`ends_at`,`event_state`,`schedule_status`,`removed_at`/u);
  assert.match(migration, /apple_wallet_ticket_refresh/u);
  assert.match(migration, /AFTER UPDATE OF `status` ON `tickets`/u);
  assert.match(migration, /apple_wallet_assignment_refresh/u);
  assert.match(migration, /attendee_id=OLD\.attendee_id/u);
  assert.match(migration, /last_pushed_tag/u);
});
