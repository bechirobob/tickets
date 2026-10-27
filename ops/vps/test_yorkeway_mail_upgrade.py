import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

# Keep independently loaded operator modules out of other tests' namespaces.
with patch.dict(sys.modules):
    metadata = load('metadata', 'inspect-mail-service-readonly.py')
    operator = load('upgrade', 'upgrade-room-mail.py')
    adapter = load('yorkeway_mail_upgrade', 'upgrade-yorkeway-mail.py')

class WelcomeUpgrade(unittest.TestCase):
    def test_historical_operator_and_inspector_remain_exact(self):
        for name, digest in {
            'upgrade-room-mail.py': '35ba0ca76549e25b2592995414d9eae50d2ffea9229f893bbc9ecb398f0e23fc',
            'inspect-mail-service-readonly.py': '7bc91b1b3b4354d0135cf068126a8f2bdcce5a16017ea514955f1fe5c8008558',
        }.items():
            self.assertEqual(hashlib.sha256((BASE/name).read_bytes()).hexdigest(), digest)

    def test_new_source_is_exact_and_only_adds_welcome(self):
        source = (BASE.parent/'email/mailer.py').read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), adapter.NEW_SOURCE)
        old = source.replace(b"'room_host_post', 'yorkeway_welcome',", b"'room_host_post',")
        self.assertEqual(hashlib.sha256(old).hexdigest(), adapter.OLD_SOURCE)
        evidence = metadata.source_evidence(source.decode())
        self.assertEqual(evidence['unknown_kind_count'], 1)
        self.assertTrue(evidence['room_host_post_supported'])
        self.assertFalse(evidence['event_host_pass_supported'])

    def test_missing_or_malformed_image_evidence_fails_closed(self):
        for value in (None, '', 'latest', 'sha256:'+'g'*64):
            with patch.object(adapter, 'OLD_IMAGE', value), self.assertRaises(ValueError):
                adapter.configure()

    def test_configuration_only_changes_reviewed_identities(self):
        before = dict(operator.__dict__)
        old_app = metadata.EXPECTED_APP
        try:
            with patch.object(adapter, 'OLD_IMAGE', 'sha256:'+'a'*64), patch.object(operator, 'command', side_effect=AssertionError('No host operation')):
                adapter.configure()
                self.assertEqual(metadata.EXPECTED_APP, adapter.EXPECTED_APP)
                for name in ('OLD_REV','OLD_SOURCE','NEW_SOURCE'):
                    self.assertEqual(getattr(operator,name),getattr(adapter,name))
                self.assertEqual(operator.OLD_IMAGE,'sha256:'+'a'*64)
                for name in ('Upgrade','MOUNTS','EXPECTED','provider_check','inspect_config','check_source_health','wait_ready'):
                    self.assertIs(operator.__dict__[name],before[name])
        finally:
            for name in ('OLD_REV','OLD_IMAGE','OLD_SOURCE','NEW_SOURCE'):
                setattr(operator,name,before[name])
            metadata.EXPECTED_APP=old_app
