import { execFileSync } from "node:child_process";

// This helper deliberately exposes no remote flag and only modifies local D1.
const start = new Date(Date.now() + 7 * 86_400_000).toISOString();
const end = new Date(Date.now() + 8 * 86_400_000).toISOString();
execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/state", "--command",
  `UPDATE curated_event_records SET starts_at = '${start}', ends_at = '${end}', sales_open_at = NULL, sales_close_at = '${start}', is_test_event = 1, schedule_status = 'confirmed', status = 'published', event_state = 'on_sale' WHERE slug = 'after-dark-osu'; UPDATE event_ticket_tiers SET status = 'available', sales_open_at = NULL, sales_close_at = '${start}' WHERE event_slug = 'after-dark-osu';`], { stdio: "inherit" });
