"""Test-only reconstruction of maintenance controls; never release admission."""
import hashlib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PATHS = ('.github/workflows/d1-recovery-rehearsal.yml', 'scripts/check-d1-recovery-runtime.mjs',
         'tests/d1-recovery-privacy.test.mjs', 'docs/runbooks/d1-recovery.md',
         '.github/workflows/deploy.yml', '.github/workflows/vps-runtime.yml',
         'ops/vps/recovery_maintenance.py', 'ops/vps/recovery_maintenance_test_support.py',
         'ops/vps/test_recovery_maintenance.py', 'ops/vps/test_code_release.py',
         'ops/vps/test_operator_evidence.py', 'ops/vps/test_runtime_workflow_contract.py',
         'ops/vps/test_yorkeway_release.py')
RECOVERY_ADDITIONS = {'ops/vps/recovery_maintenance.py', 'ops/vps/recovery_maintenance_test_support.py',
                      'ops/vps/test_recovery_maintenance.py'}
# Existing staged-archive fixture builders consume ADDITIONS for the current
# checked-out archive. Historical recovery overlay allowance stays separate.
ADDITIONS = RECOVERY_ADDITIONS | {
    'ops/vps/box_office_standby_boundary.py', 'ops/vps/test_box_office_standby_boundary.py',
}

def digest(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

# Captured once from the executing reviewed suite, not the candidate fixture.
# The release classifier independently authenticates the immutable payload tree.
OVERLAY = {name: ('100644', digest((ROOT / name).read_bytes())) for name in PATHS if (ROOT / name).is_file()}
BASE_WORKFLOWS = {'.github/workflows/deploy.yml': '0bf4539141356389a96f768ac8305e1355d86834',
                  '.github/workflows/vps-runtime.yml': '06bdc48477eb0977ed471e549630bd6070758a95'}


BOX_OFFICE_DEPLOY_BLOB = '40f5660995c0125ff9776f9076e532801e7769b2'
PRE_BOX_OFFICE_DEPLOY_BLOB = '268260bd7642ee1430568aaeeff0a788389535e8'


def restore_box_office_deploy(raw):
    """Only the exact checked-in overlay may restore the earlier reviewed byte shape."""
    if digest(raw) != BOX_OFFICE_DEPLOY_BLOB:
        return raw
    paths = (
        b"      - 'ops/vps/box_office_standby_boundary.py'\n"
        b"      - 'ops/vps/test_box_office_standby_boundary.py'\n"
        b"      - 'ops/vps/recovery_maintenance_test_support.py'\n"
        b"      - 'ops/vps/test_audit_readiness.py'\n"
    )
    needs = (b"    needs: [box_office_standby_boundary]\n"
             b"    if: needs.box_office_standby_boundary.outputs.allow_cloudflare == 'true'\n")
    start = b'  box_office_standby_boundary:\n'
    end = b'  deploy:\n'
    if any(raw.count(block) != 1 for block in (paths, needs, start, end)):
        raise AssertionError('Box Office workflow overlay is ambiguous or incomplete')
    left, right = raw.index(start), raw.index(end)
    if left >= right:
        raise AssertionError('Box Office workflow overlay ordering differs')
    raw = (raw[:left] + raw[right:]).replace(paths, b'', 1).replace(needs, b'', 1)
    if digest(raw) != PRE_BOX_OFFICE_DEPLOY_BLOB:
        raise AssertionError('Box Office changed unrelated historical deployment controls')
    return raw


def restore_workflow(name, raw):
    if name not in BASE_WORKFLOWS or b'Classify exact recovery maintenance' not in raw:
        return raw
    # Accept only the executing suite's exact new workflow bytes. All historical
    # pin tests still check the reconstructed original bytes below.
    if digest(raw) != OVERLAY[name][1]:
        return raw
    if name == '.github/workflows/deploy.yml':
        raw = restore_box_office_deploy(raw)
    start = raw.index(b'      - name: Classify exact recovery maintenance\n')
    end = raw.index(b'      - name: Verify exact source ancestry', start)
    raw = raw[:start] + raw[end:]
    raw = raw.replace(b"        if: steps.recovery_maintenance.outputs.matches != 'true'\n", b'')
    raw = raw.replace(b'    outputs:\n      recovery_maintenance: ${{ steps.recovery_maintenance.outputs.matches }}\n', b'')
    raw = raw.replace(b"    if: needs.verify.outputs.recovery_maintenance != 'true'\n", b'')
    paths = PATHS[:4]
    if name.endswith('/deploy.yml'):
        block = b'      # Recovery maintenance is not an application release.\n' + b''.join(("      - '"+p+"'\n").encode() for p in paths)
    else:
        block = b'      # Keep exclusions after positive patterns; mixed app changes still run.\n' + b''.join(("      - '!"+p+"'\n").encode() for p in paths)
    if raw.count(block) != 1:
        raise AssertionError('Missing exact recovery exclusions')
    raw = raw.replace(block, b'', 1)
    if digest(raw) != BASE_WORKFLOWS[name]:
        raise AssertionError('Recovery change altered existing release controls')
    return raw


def overlay_manifest(root, manifest, *, staged):
    if not (Path(root) / 'ops/vps/recovery_maintenance.py').exists():
        return
    for name in BASE_WORKFLOWS:
        restore_workflow(name, (Path(root) / name).read_bytes())
    manifest.update({name: value for name, value in OVERLAY.items()
                     if not staged or name in manifest or name in RECOVERY_ADDITIONS})
