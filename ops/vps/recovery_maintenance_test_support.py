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


BOX_OFFICE_DEPLOY_BLOB = 'ffc2efacd307da66d64e55d3af524011819da3f8'
PRE_BOX_OFFICE_DEPLOY_BLOB = '268260bd7642ee1430568aaeeff0a788389535e8'


def restore_box_office_deploy(raw):
    """Only the exact checked-in overlay may restore the earlier reviewed byte shape."""
    if digest(raw) == 'dcecb18c8ba5916587a4f09970bb44f676f61e60':
        unified = b'          BECORE_UNIFIED_BASE: 46ef0197aa524459d26f3ff046c9da75b929881f\n          BECORE_UNIFIED_BASE_TREE: 32b464ae8d13393b41de13d089ec86e08f61629e\n          BECORE_UNIFIED_SNAPSHOT: 35a15e5cf3ae9c9699e3288d4133ef4ba884d2f9\n          BECORE_UNIFIED_SNAPSHOT_TREE: b9a04220ba265f0405f89227346cea7531c1a980\n'
        if raw.count(unified) != 1:
            raise AssertionError('Unified standby overlay is ambiguous or incomplete')
        raw = raw.replace(unified, b'', 1)
        if digest(raw) != 'b7750995662249f55e2e28a6662f36927083a9e3':
            raise AssertionError('Unified standby altered the underlying reviewed workflow')
    if digest(raw) == 'b7750995662249f55e2e28a6662f36927083a9e3':
        overlay = b'          BECORE_CANVAS_BASE: 024eaef59cb08ef277ec6c1598406d6c4ba06862\n          BECORE_CANVAS_BASE_TREE: 5e4790e1c3cf3262fded40d8178e98dd46a4502e\n          BECORE_CANVAS_SNAPSHOT: afc1dd1b01eaa9841778f099b5f5573a5ac9007b\n          BECORE_CANVAS_SNAPSHOT_TREE: 01edccf5930337b3e885cf947d2af9091aa0a419\n'
        if raw.count(overlay) != 1:
            raise AssertionError('Mobile standby overlay is ambiguous or incomplete')
        raw = raw.replace(overlay, b'', 1)
        if digest(raw) != BOX_OFFICE_DEPLOY_BLOB:
            raise AssertionError('Mobile standby altered the underlying reviewed workflow')
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
