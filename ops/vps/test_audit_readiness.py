"""Read-only diagnostics contract tests using disposable isolated SQLite files."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('audit_readiness', Path(__file__).with_name('audit-readiness.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class ReadinessTests(unittest.TestCase):
    def test_secret_values_never_returned(self):
        data = {k: 'private-test-value' for k in audit.SECRET_NAMES}
        data.update(ENVIRONMENT='production', SEEV_ENABLED='true', SEEV_ENVIRONMENT='production')
        result = audit.configuration_summary(data)
        self.assertNotIn('private-test-value', json.dumps(result))
        self.assertTrue(all(result['present'].values()))
        self.assertTrue(result['production'])

    def test_domain_read_is_fixed_target_and_never_returns_credentials(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"data":[{"name":"becoreops.com","status":"verified"},{"name":"unrelated.test","status":"failed"}]}'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(audit.urllib.request, 'build_opener', return_value=opener):
            result = audit.resend_domain_summary({'RESEND_API_KEY':'private-key', 'EMAIL_FROM':'BeCore Tickets <tickets@becoreops.com>'})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.resend.com/domains?limit=100')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(result['status'], 'verified')
        self.assertNotIn('private-key', json.dumps(result))
        self.assertNotIn('unrelated.test', json.dumps(result))
        self.assertFalse(result['quota_verified'])

    def test_send_only_key_rejection_stays_unverified_without_retry(self):
        opener = MagicMock()
        opener.open.side_effect = audit.urllib.error.HTTPError('https://api.resend.com/domains',403,'hidden',None,None)
        with patch.object(audit.urllib.request, 'build_opener', return_value=opener):
            result = audit.resend_domain_summary({'RESEND_API_KEY':'private-key','EMAIL_FROM':'tickets@becoreops.com'})
        self.assertEqual(result['reason'], 'metadata_access_denied')
        self.assertEqual(opener.open.call_count, 1)
        self.assertNotIn('hidden', json.dumps(result))

    def test_database_observation_preserves_rows_and_omits_personal_data(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tickets.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE delivery_events(status TEXT, recipient TEXT); INSERT INTO delivery_events VALUES('failed','private@example.test'); CREATE TABLE background_job_health(job_key TEXT,started_at TEXT,finished_at TEXT,last_success_at TEXT,last_failure_at TEXT,failure_count INTEGER);")
            db.commit(); db.close()
            before = path.read_bytes()
            result = audit.inspect_database(path, True)
            self.assertEqual(result['counts']['delivery_events']['failed'], 1)
            self.assertTrue(result['quick_check_ok'])
            self.assertNotIn('private@example.test', json.dumps(result))
            self.assertEqual(path.read_bytes(), before)

    def test_owner_count_and_guard_metadata_are_aggregate_only(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tickets.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE staff_accounts(role TEXT,status TEXT,email TEXT); INSERT INTO staff_accounts VALUES('owner','active','private@example.test'); CREATE TRIGGER staff_last_active_owner_update_guard BEFORE UPDATE ON staff_accounts BEGIN SELECT 1; END;")
            db.commit(); db.close()
            result = audit.inspect_database(path, True)
            self.assertEqual(result['active_owner_count'], 1)
            self.assertTrue(result['owner_update_guard_present'])
            self.assertNotIn('private@example.test', json.dumps(result))

    def test_queue_overdue_counts_without_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'operations.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE delivery_queue(available INTEGER, lease INTEGER, body TEXT); INSERT INTO delivery_queue VALUES(1,NULL,'secret payload');")
            db.commit(); db.close()
            result = audit.inspect_database(path)
            self.assertEqual(result['overdue'], 1)
            self.assertNotIn('secret payload', json.dumps(result))

if __name__ == '__main__': unittest.main()
