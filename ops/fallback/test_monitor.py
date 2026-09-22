import json
import unittest
from unittest.mock import patch
import tempfile
import pathlib
from monitor import classify, decide, main, RULE_REF, EXPRESSION, ACTION

class MonitorTest(unittest.TestCase):
    def test_only_cloudflare_quota_error_activates(self):
        body = b'<h1>Error 1027</h1>'
        self.assertEqual(classify(429, {'server': 'cloudflare'}, body), 'quota')
        self.assertEqual(classify(429, {'server': 'app'}, body), 'unknown')
        self.assertEqual(classify(429, {'server': 'cloudflare'}, b'Login rate limit'), 'unknown')
        self.assertEqual(classify(503, {'server': 'cloudflare'}, body), 'unknown')
        self.assertTrue(decide({}, 'quota')[1])

    def test_a_generic_200_is_not_recovery(self):
        self.assertEqual(classify(200, {'content-type': 'text/html'}, b'Maintenance'), 'unknown')
        self.assertEqual(classify(200, {'content-type': 'application/json'}, b'{}'), 'unknown')
        body = json.dumps({'service': 'becore-tickets', 'revision': 'a' * 40}).encode()
        self.assertEqual(classify(200, {'content-type': 'application/json'}, body), 'healthy')

    def test_recovery_requires_three_consecutive_valid_probes(self):
        state = {}
        for _ in range(2):
            state, desired = decide(state, 'healthy')
            self.assertIsNone(desired)
        state, desired = decide(state, 'unknown')
        self.assertIsNone(desired)
        for _ in range(2):
            state, desired = decide(state, 'healthy')
            self.assertIsNone(desired)
        _, desired = decide(state, 'healthy')
        self.assertIs(desired, False)

    def test_unhealthy_fallback_never_changes_routing(self):
        env = {'CLOUDFLARE_API_TOKEN': 'test-only', 'CLOUDFLARE_ZONE_ID': 'a' * 32,
               'CLOUDFLARE_FALLBACK_RULESET_ID': 'b' * 32, 'CLOUDFLARE_FALLBACK_RULE_ID': 'c' * 32}
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {**env, 'STATE_DIRECTORY': directory}), patch('monitor.api') as api:
            with patch('monitor.request', side_effect=[(429, {'server': 'cloudflare'}, b'Error 1027'), (502, {}, b'down')]):
                with self.assertRaisesRegex(RuntimeError, 'not healthy'):
                    main()
            api.assert_not_called()

    def test_confirmed_quota_enables_only_the_owned_rule(self):
        env = {'CLOUDFLARE_API_TOKEN': 'test-only', 'CLOUDFLARE_ZONE_ID': 'a' * 32,
               'CLOUDFLARE_FALLBACK_RULESET_ID': 'b' * 32, 'CLOUDFLARE_FALLBACK_RULE_ID': 'c' * 32}
        rule = {'id': 'c' * 32, 'ref': RULE_REF, 'action': 'redirect', 'expression': EXPRESSION, 'action_parameters': ACTION, 'enabled': False}
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {**env, 'STATE_DIRECTORY': directory}):
            with patch('monitor.request', side_effect=[(429, {'server': 'cloudflare'}, b'Error 1027'), (200, {}, b'becore-tickets-fallback-ready')]), patch('monitor.api', side_effect=[{'rules': [rule]}, {}, {'rules': [{**rule, 'enabled': True}]}]) as api:
                main()
            writes = [call for call in api.call_args_list if len(call.args) > 2]
            self.assertEqual(len(writes), 1)
            self.assertTrue(writes[0].args[0].endswith('/rules/' + 'c' * 32))
            self.assertEqual(writes[0].args[2], 'PATCH')
            self.assertTrue(writes[0].args[3]['enabled'])
            self.assertFalse(writes[0].args[3]['action_parameters']['from_value']['preserve_query_string'])
            self.assertEqual(pathlib.Path(directory, 'state.json').stat().st_mode & 0o777, 0o600)

    def test_recovery_disables_owned_redirect_after_three_saved_healthy_checks(self):
        env = {'CLOUDFLARE_API_TOKEN': 'test-only', 'CLOUDFLARE_ZONE_ID': 'a' * 32,
               'CLOUDFLARE_FALLBACK_RULESET_ID': 'b' * 32, 'CLOUDFLARE_FALLBACK_RULE_ID': 'c' * 32}
        rule = {'id': 'c' * 32, 'ref': RULE_REF, 'action': 'redirect', 'expression': EXPRESSION, 'action_parameters': ACTION, 'enabled': True}
        healthy = (200, {'content-type': 'application/json'}, json.dumps({'service': 'becore-tickets', 'revision': 'd' * 40}).encode())
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {**env, 'STATE_DIRECTORY': directory}):
            with patch('monitor.request', return_value=healthy), patch('monitor.api', side_effect=[{'rules': [rule]}, {}, {'rules': [{**rule, 'enabled': False}]}]) as api:
                main()
                main()
                api.assert_not_called()
                main()
            writes = [call for call in api.call_args_list if len(call.args) > 2]
            self.assertEqual(len(writes), 1)
            self.assertTrue(writes[0].args[0].endswith('/rules/' + 'c' * 32))
            self.assertEqual(writes[0].args[2], 'PATCH')
            self.assertFalse(writes[0].args[3]['enabled'])
            self.assertEqual(json.loads(pathlib.Path(directory, 'state.json').read_text())['healthy'], 3)

    def test_changed_rule_is_not_overwritten(self):
        env = {'CLOUDFLARE_API_TOKEN': 'test-only', 'CLOUDFLARE_ZONE_ID': 'a' * 32,
               'CLOUDFLARE_FALLBACK_RULESET_ID': 'b' * 32, 'CLOUDFLARE_FALLBACK_RULE_ID': 'c' * 32}
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {**env, 'STATE_DIRECTORY': directory}):
            with patch('monitor.request', side_effect=[(429, {'server': 'cloudflare'}, b'Error 1027'), (200, {}, b'becore-tickets-fallback-ready')]), patch('monitor.api', return_value={'rules': [{'id': 'c' * 32, 'ref': 'someone-elses-rule'}]}) as api:
                with self.assertRaisesRegex(RuntimeError, 'changed outside'):
                    main()
            self.assertEqual(api.call_count, 1)

if __name__ == '__main__':
    unittest.main()
