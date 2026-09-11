export const TICKETS_AI_GATEWAY_ID = "becore-tickets-ai";

export const TICKETS_AI_SPEND_LIMITS = {
  enabled: true,
  rules: [
    {
      id: "tickets-ai-daily",
      enabled: true,
      limitType: "cost",
      limit: 5,
      window: 86_400,
      technique: "sliding",
    },
    {
      id: "tickets-ai-30-day",
      enabled: true,
      limitType: "cost",
      limit: 25,
      window: 2_592_000,
      technique: "sliding",
    },
    {
      id: "tickets-ai-user-daily",
      enabled: true,
      limitType: "cost",
      limit: 1,
      window: 86_400,
      technique: "sliding",
      metadata: {
        user_id: { mode: "partition" },
      },
    },
  ],
};

function limitType(rule) {
  return rule?.limitType ?? rule?.limit_type;
}

function isUnscoped(rule) {
  return (!rule?.metadata || Object.keys(rule.metadata).length === 0)
    && !rule?.model
    && !rule?.provider;
}

function isPerUser(rule) {
  return rule?.metadata?.user_id?.mode === "partition"
    && Object.keys(rule.metadata ?? {}).length === 1
    && !rule?.model
    && !rule?.provider;
}

function matchesRule(rule, expected, scope) {
  return rule?.enabled !== false
    && limitType(rule) === "cost"
    && Number(rule?.limit) === expected.limit
    && Number(rule?.window) === expected.window
    && rule?.technique === "sliding"
    && (scope === "user" ? isPerUser(rule) : isUnscoped(rule));
}

export function hasRequiredTicketsSpendLimits(result) {
  const spendLimits = result?.spend_limits ?? result?.spendLimits;
  const rules = Array.isArray(spendLimits?.rules) ? spendLimits.rules : [];
  if (result?.id !== TICKETS_AI_GATEWAY_ID || spendLimits?.enabled !== true) return false;

  const daily = TICKETS_AI_SPEND_LIMITS.rules[0];
  const monthly = TICKETS_AI_SPEND_LIMITS.rules[1];
  const userDaily = TICKETS_AI_SPEND_LIMITS.rules[2];

  return rules.some((rule) => matchesRule(rule, daily, "global"))
    && rules.some((rule) => matchesRule(rule, monthly, "global"))
    && rules.some((rule) => matchesRule(rule, userDaily, "user"));
}
