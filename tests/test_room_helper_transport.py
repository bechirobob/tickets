"""Pin the reviewed release job and exercise its complete host file transport."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = '.github/workflows/tickets-room-helper-transport.yml'
SOURCE = '36c30bd61415460b7383e857b9407bef753185ea'
TRUSTED = 'a62985c899de8e82728d5c0a515504f9e405443d'
BASE_WORKFLOW_BLOB = '8e516ab2b92cf9c9fdb59cf3ef802f23fc2b5879'
OPERATOR_BLOB = '3ce9952c547073a76b5bfb43a8996d1c9c65af1e'
HELPER_COPY = '''          tailscale ssh root@hermes "umask 022; cat > '$stage/inspect-mail-service-readonly.py'" < "$RUNNER_TEMP/tickets-operator/ops/vps/inspect-mail-service-readonly.py"\n'''
HEADER = '''name: Release pinned Tickets Room helper transport
on:
  pull_request:
    branches: [main]
    paths:
      - .github/workflows/tickets-room-helper-transport.yml
      - tests/test_room_helper_transport.py
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: tickets-vps-handover
  cancel-in-progress: false
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
          persist-credentials: false
      - name: Verify exact transport and fail-closed helper loading
        run: python3 -B -m unittest discover -s tests -p test_room_helper_transport.py -v
  release:
'''

def blob(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def expected_workflow():
    raw = (ROOT / '.github/workflows/tickets-code-release.yml').read_bytes()
    if blob(raw) != BASE_WORKFLOW_BLOB:
        raise AssertionError('Original reviewed workflow changed')
    job = raw.decode().split('\n  release:\n', 1)[1].split('\n  inspect_failure:', 1)[0]
    replacements = {
        "    if: github.ref == 'refs/heads/main' && (!inputs.inspect_failed_release || inputs.verify_only)":
        "    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
        '    runs-on: ubuntu-latest': '    needs: verify\n    permissions:\n      contents: read\n      actions: read\n      id-token: write\n    runs-on: ubuntu-latest',
        '${{ inputs.source_sha }}': SOURCE,
        '${{ inputs.trusted_base }}': TRUSTED,
        '${{ inputs.expected_active }}': '885bd1b2d97ff687fe884c86314ae9b368d4abff',
        '${{ inputs.runtime_run }}': "'40143329504'",
        '${{ inputs.candidate_run }}': "'40141189481'",
        "${{ inputs.candidate_mode || 'legacy' }}": 'parallel-v1',
        "${{ inputs.verify_only && 'true' || 'false' }}": "'false'",
        "${{ inputs.inspect_failed_release && 'true' || 'false' }}": "'false'",
        '${{ inputs.recover_prepared }}': "''",
        "${{ inputs.enable_crypto && 'true' || 'false' }}": "'false'",
        "${{ inputs.enable_first_host && 'true' || 'false' }}": "'false'",
        "${{ inputs.enable_first_host && secrets.TICKETS_FIRST_HOST_ACCOUNT_ID || '' }}": "''",
        '${{ !inputs.verify_only }}': "${{ github.event_name == 'workflow_dispatch' }}",
        '${{ inputs.verify_only }}': 'false',
    }
    for before, after in replacements.items():
        if before not in job:
            raise AssertionError('Required original boundary missing: ' + before)
        job = job.replace(before, after)
    anchor = '''          tailscale ssh root@hermes "umask 077; cat > '$stage/code-release.py'" < "$RUNNER_TEMP/tickets-operator/ops/vps/code-release.py"\n'''
    if job.count(anchor) != 1 or 'inputs.' in job:
        raise AssertionError('Unbounded or changed release job')
    postflight = '\n  retired_preview:' + raw.decode().split('\n  retired_preview:', 1)[1]
    postflight = postflight.replace('${{ !inputs.verify_only }}', "${{ github.event_name == 'workflow_dispatch' }}").replace('${{ inputs.source_sha }}', SOURCE)
    if 'inputs.' in postflight:
        raise AssertionError('Unbounded postflight job')
    return HEADER + job.replace(anchor, anchor + HELPER_COPY, 1) + postflight


class RoomHelperTransportTests(unittest.TestCase):
    def test_exact_reviewed_job_only_adds_helper_and_fixed_inputs(self):
        self.assertEqual((ROOT / WORKFLOW).read_text(), expected_workflow())
        self.assertEqual(blob((ROOT / 'ops/vps/code-release.py').read_bytes()), OPERATOR_BLOB)

    def test_host_transport_supplies_the_exact_loadable_helper(self):
        workflow = expected_workflow()
        lines = workflow.splitlines()
        begin = next(i for i, line in enumerate(lines) if 'tailscale ssh root@hermes "umask 077; mkdir' in line)
        end = next(i for i, line in enumerate(lines) if "printf '%s'" in line and 'apply --source' in line)
        transfer = '\n'.join(line[10:] for line in lines[begin:end])
        spec = importlib.util.spec_from_file_location('room_transport_release', ROOT / 'ops/vps/code-release.py')
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); operator = root / 'tickets-operator/ops/vps'; operator.mkdir(parents=True)
            for name in ('code-release.py', 'inspect-mail-service-readonly.py'):
                (operator / name).write_bytes((ROOT / 'ops/vps' / name).read_bytes())
            metadata = root / 'tickets-code-release'; (metadata / 'artifact').mkdir(parents=True)
            (metadata / 'artifact/tickets-vps-runtime.tar.gz').write_bytes(b'public synthetic archive')
            (metadata / 'provenance.json').write_text('{}')
            audit = root / 'tickets-final-audit'; audit.mkdir(); (audit / 'npm-audit.json').write_text('{}')
            stage = root / 'stage'
            shell = 'set -euo pipefail\ntailscale() { test "$1" = ssh; test "$2" = root@hermes; bash -c "$3"; }\n' + transfer
            env = {**os.environ, 'RUNNER_TEMP': str(root), 'stage': str(stage), 'metadata': str(metadata)}
            subprocess.run(['bash', '-c', shell], check=True, env=env, capture_output=True)
            self.assertEqual(stage.stat().st_mode & 0o777, 0o700)
            helper = stage / 'inspect-mail-service-readonly.py'
            self.assertEqual(helper.stat().st_mode & 0o777, 0o644)
            self.assertEqual(blob(helper.read_bytes()), release.ROOM_MAIL_VPS_PREREQUISITE_BLOBS['ops/vps/inspect-mail-service-readonly.py'])
            with patch.object(release, '__file__', str(stage / 'code-release.py')):
                self.assertEqual(release.load_room_mail_vps_inspector().CONTAINER, 'becore-tickets-mail')
                original = helper.read_bytes()
                for mutation in ('missing', 'bytes', 'mode'):
                    helper.unlink(missing_ok=True)
                    if mutation != 'missing':
                        helper.write_bytes(original if mutation == 'mode' else b'wrong helper')
                        helper.chmod(0o600 if mutation == 'mode' else 0o644)
                    with self.subTest(mutation=mutation), self.assertRaises(release.ReleaseError):
                        release.load_room_mail_vps_inspector()


if __name__ == '__main__':
    unittest.main()
