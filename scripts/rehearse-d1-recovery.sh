#!/usr/bin/env bash
set -euo pipefail

export_file="${D1_EXPORT_FILE:-}"
report_file="${RECOVERY_REPORT_FILE:-recovery-rehearsal-report.json}"
bookmark_file="${D1_BOOKMARK_FILE:-}"

if [[ -z "$export_file" || ! -f "$export_file" ]]; then
  echo "Set D1_EXPORT_FILE to a completed D1 SQL export." >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for the isolated restore rehearsal." >&2
  exit 1
fi

recovery_dir="$(mktemp -d)"
recovery_db="$recovery_dir/recovered.sqlite3"
trap 'rm -rf -- "$recovery_dir"' EXIT

sqlite3 "$recovery_db" ".read $export_file"
quick_check="$(sqlite3 "$recovery_db" 'PRAGMA quick_check;')"
integrity_check="$(sqlite3 "$recovery_db" 'PRAGMA integrity_check;')"
if [[ "$quick_check" != "ok" || "$integrity_check" != "ok" ]]; then
  echo "The restored export did not pass SQLite integrity checks." >&2
  exit 1
fi

required_tables=(
  curated_event_records
  orders
  tickets
  staff_accounts
  consent_records
  delivery_events
  product_metrics_daily
)
for table in "${required_tables[@]}"; do
  present="$(sqlite3 "$recovery_db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")"
  if [[ "$present" != "1" ]]; then
    echo "Recovered export is missing required table: $table" >&2
    exit 1
  fi
done

counts_json="$(sqlite3 -json "$recovery_db" "
  SELECT
    (SELECT COUNT(*) FROM curated_event_records) AS events,
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM tickets) AS tickets,
    (SELECT COUNT(*) FROM staff_accounts) AS staffAccounts,
    (SELECT COUNT(*) FROM consent_records) AS consentRecords,
    (SELECT COUNT(*) FROM delivery_events) AS deliveryEvents;
")"
export RECOVERY_EXPORT_SHA256="$(sha256sum "$export_file" | cut -d' ' -f1)"
export RECOVERY_EXPORT_BYTES="$(wc -c < "$export_file" | tr -d ' ')"
export RECOVERY_COUNTS_JSON="$counts_json"
export RECOVERY_QUICK_CHECK="$quick_check"
export RECOVERY_INTEGRITY_CHECK="$integrity_check"
export RECOVERY_BOOKMARK=""
if [[ -n "$bookmark_file" && -f "$bookmark_file" ]]; then
  export RECOVERY_BOOKMARK="$(node --input-type=module -e "import { readFileSync } from 'node:fs'; const x=JSON.parse(readFileSync(process.argv[1], 'utf8')); process.stdout.write(String(x.bookmark||''));" "$bookmark_file")"
fi

node --input-type=module - "$report_file" <<'NODE'
import { writeFile } from "node:fs/promises";

const report = {
  rehearsedAt: new Date().toISOString(),
  result: "passed",
  sourceBookmark: process.env.RECOVERY_BOOKMARK || null,
  export: {
    sha256: process.env.RECOVERY_EXPORT_SHA256,
    bytes: Number(process.env.RECOVERY_EXPORT_BYTES),
  },
  restore: {
    target: "isolated temporary SQLite database",
    quickCheck: process.env.RECOVERY_QUICK_CHECK,
    integrityCheck: process.env.RECOVERY_INTEGRITY_CHECK,
    requiredTables: "present",
    rowCounts: JSON.parse(process.env.RECOVERY_COUNTS_JSON || "[]")[0] ?? {},
  },
  productionChanged: false,
};
await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE
