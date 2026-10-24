import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mail_inspect', Path(__file__).with_name('inspect-mail-service-readonly.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE = "KINDS={'room_host_post','payment_confirmation'}\ndef never_called():\n raise RuntimeError('private sentinel')\n"


class MailInspection(unittest.TestCase):
    def test_source_is_parsed_not_executed(self):
        result = m.source_evidence(SOURCE + "raise RuntimeError('never execute')\n")
        self.assertTrue(result['room_host_post_supported'])
        self.assertFalse(result['event_host_pass_supported'])
        self.assertFalse(result['retention_runtime_verified'])
        self.assertNotIn('sentinel', json.dumps(result))

    def test_unknown_kinds_are_not_exported(self):
        result = m.source_evidence("KINDS={'private_name','room_host_post'}")
        self.assertEqual(result['unknown_kind_count'], 1)
        self.assertNotIn('private_name', json.dumps(result))

    def test_dynamic_invalid_or_duplicate_allowlists_fail_closed(self):
        for value in ["KINDS=load()", "KINDS={'room_host_post'}\nKINDS={'other'}", "KINDS={'private@example.com'}", "KINDS={1}", "KINDS=[]"]:
            with self.subTest(value=value), self.assertRaises((ValueError, TypeError)):
                m.source_evidence(value)

    def test_retention_is_exact_static_evidence_not_runtime_claim(self):
        source = "KINDS={'room_host_post'}\ndef f():\n db.execute(" + repr(m.RETENTION_SQL) + ", (time.time() - 7 * 86400,))"
        self.assertTrue(m.source_evidence(source)['historical_terminal_payload_clear_after_7_days_syntax_present'])
        self.assertFalse(m.source_evidence(source.replace('7 *', '8 *'))['historical_terminal_payload_clear_after_7_days_syntax_present'])

    def test_selective_inspect_rejects_nonrunning_or_untrusted_fields(self):
        valid = '"' + 'a'*64 + '" "sha256:' + 'b'*64 + '" true "2026-10-24T12:00:00Z"'
        with patch.object(m, 'command', return_value=valid) as command:
            self.assertEqual(m.identity()[2], True)
            self.assertNotIn('.Config', command.call_args.args[0][4])
        for raw in [valid.replace(' true ', ' false '), valid.replace('2026-10-24T12:00:00Z', 'private value')]:
            with patch.object(m, 'command', return_value=raw), self.assertRaises((ValueError, json.JSONDecodeError)):
                m.identity()

    def run_main(self, *, identity_changed=False, health_changed=False, fail_stage=None):
        ident=['a'*64,'sha256:'+'b'*64,True,'2026-10-24T12:00:00Z']
        h={'service':'becore-tickets-mail','revision':'c'*40,'sendingEnabled':True}
        second_h={**h,'sendingEnabled':False} if health_changed else h
        def command(args, limit=262144):
            if args[0]=='systemctl':
                return 'ActiveState=active\nWorkingDirectory=/srv/becore-tickets/releases/'+m.EXPECTED_APP+'\n'
            self.assertEqual(args,['docker','exec',m.CONTAINER,'python3','-B','-c',m.SOURCE_READ])
            return SOURCE
        with patch.object(m.os,'geteuid',return_value=0), patch.object(m.os,'open',return_value=100), \
             patch.object(m.os,'close'), patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()), \
             patch.object(m.fcntl,'flock'), patch.object(m,'marker',return_value='c'*40,side_effect=FileNotFoundError('secret') if fail_stage=='revision_marker' else None), \
             patch.object(m,'health',side_effect=ValueError('secret') if fail_stage=='health' else [h,second_h]), \
             patch.object(m,'identity',side_effect=ValueError('secret') if fail_stage=='container' else [ident,[*ident[:3],'2026-10-25T00:00:00Z'] if identity_changed else ident]), \
             patch.object(m,'command',side_effect=command), contextlib.redirect_stdout(io.StringIO()) as output:
            m.main()
            return json.loads(output.getvalue())

    def test_complete_mocked_inspection_is_redacted_and_read_only(self):
        result=self.run_main()
        self.assertEqual(result['messages_sent'],0)
        self.assertEqual(result['secrets_read'],0)
        self.assertEqual(result['databases_opened'],0)
        self.assertNotIn('sentinel',json.dumps(result))

    def test_changed_container_or_health_prevents_evidence_export(self):
        for args in [{'identity_changed':True},{'health_changed':True}]:
            with self.assertRaises(ValueError): self.run_main(**args)

    def test_actual_pipeline_identifies_failed_stage(self):
        for stage in ['revision_marker','container','health']:
            try:
                self.run_main(fail_stage=stage)
            except (ValueError,FileNotFoundError) as error:
                result=m.safe_failure(error)
                self.assertEqual(result['stage'],stage)
                self.assertNotIn('secret',json.dumps(result))
            else:
                self.fail('Expected bounded failure')

    def test_failures_export_stage_and_safe_category_only(self):
        import subprocess
        import urllib.error
        for stage,error,category in [
            ('revision_marker',FileNotFoundError('secret path'),'not_found'),
            ('container',subprocess.CalledProcessError(1,['private'],stderr='secret'),'command_failed'),
            ('health',urllib.error.HTTPError('private',503,'secret',{},None),'http_error'),
            ('health',urllib.error.URLError('secret'),'network_error'),
            ('source',ValueError('private source'),'validation_failed')]:
            with patch.object(m,'STAGE',stage):
                result=m.safe_failure(error)
            self.assertEqual(result['stage'],stage)
            self.assertEqual(result['category'],category)
            self.assertNotIn('secret',json.dumps(result))
            self.assertNotIn('private',json.dumps(result))
        self.assertIn('identity(s)==identity(after)==identity(path)',m.SOURCE_READ)

    def test_no_redirect_and_no_writing_or_sensitive_sources(self):
        with self.assertRaises(ValueError):m.NoRedirect().redirect_request()
        self.assertIn('O_NOFOLLOW',m.SOURCE_READ)
        self.assertNotIn('import mailer',m.SOURCE_READ)
        source=Path(m.__file__).read_text()
        for forbidden in ['sqlite3','api.key','dkim.private','docker logs','Config.Env','/v1/emails','/v1/status']:
            self.assertNotIn(forbidden,source)


if __name__=='__main__': unittest.main()
