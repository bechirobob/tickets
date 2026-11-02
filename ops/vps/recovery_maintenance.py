"""One reviewed recovery-maintenance tree; never application release admission.

The two workflow literals select an immutable reviewed payload commit. The final
source differs from that payload only by replacing those literals with its SHA.
No manifest supplied by the candidate can expand the permitted source inventory.
"""
import hashlib
import os
from pathlib import Path
import re
import subprocess

BASE = '63f2ead2fb3eaae03696f408b12e9e18cfcee265'
PLACEHOLDER = b'REVIEWED_RECOVERY_SOURCE'
WORKFLOWS = ('.github/workflows/deploy.yml', '.github/workflows/vps-runtime.yml')
ALLOWED = frozenset({
    *WORKFLOWS, '.github/workflows/d1-recovery-rehearsal.yml',
    'scripts/check-d1-recovery-runtime.mjs', 'docs/runbooks/d1-recovery.md',
    'tests/d1-recovery-privacy.test.mjs',
    'ops/vps/recovery_maintenance.py', 'ops/vps/recovery_maintenance_test_support.py',
    'ops/vps/test_recovery_maintenance.py', 'ops/vps/test_code_release.py',
    'ops/vps/test_operator_evidence.py', 'ops/vps/test_runtime_workflow_contract.py',
    'ops/vps/test_yorkeway_release.py',
})
SHA = re.compile(r'[a-f0-9]{40}\Z')


def git(root, *args):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0')
    return subprocess.check_output(['git', '-C', str(root), *args], env=env, stderr=subprocess.DEVNULL, timeout=30)


def blob(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def inventory(root, revision):
    result = {}
    for entry in git(root, 'ls-tree', '-rz', '--full-tree', revision).split(b'\0'):
        if entry:
            metadata, path = entry.split(b'\t', 1)
            mode, kind, digest = metadata.decode().split()
            if kind != 'blob' or mode not in ('100644', '100755'):
                raise ValueError('Unsupported tree entry')
            result[path.decode()] = (mode, digest)
    return result


def expected_inventory(root, reviewed):
    if not SHA.fullmatch(reviewed) or reviewed == BASE:
        raise ValueError('Missing exact reviewed payload')
    git(root, 'merge-base', '--is-ancestor', BASE, reviewed)
    original = inventory(root, BASE)
    expected = inventory(root, reviewed)
    changed = {p for p in original.keys() | expected.keys() if original.get(p) != expected.get(p)}
    if changed != ALLOWED or any(expected.get(p, ('',))[0] != '100644' for p in ALLOWED):
        raise ValueError('Reviewed payload changed unexpected or incomplete scope')
    for path in WORKFLOWS:
        raw = git(root, 'show', reviewed + ':' + path)
        line = b'          RECOVERY_MAINTENANCE_SOURCE: ' + PLACEHOLDER + b'\n'
        if raw.count(line) != 1:
            raise ValueError('Missing exact workflow source pin')
        expected[path] = ('100644', blob(raw.replace(line, line.replace(PLACEHOLDER, reviewed.encode()), 1)))
    return expected


def verify_tree(root, reviewed, candidate):
    if not SHA.fullmatch(candidate):
        raise ValueError('Missing exact candidate')
    git(root, 'merge-base', '--is-ancestor', reviewed, candidate)
    expected = expected_inventory(root, reviewed)
    if inventory(root, candidate) != expected:
        raise ValueError('Candidate differs from reviewed maintenance tree')
    # The direct pinning commit or its exact two-parent merge onto BASE only.
    parents = git(root, 'show', '-s', '--format=%P', candidate).decode().split()
    if parents != [reviewed]:
        if len(parents) != 2 or parents[0] != BASE:
            raise ValueError('Unexpected maintenance ancestry')
        if git(root, 'show', '-s', '--format=%P', parents[1]).decode().split() != [reviewed]:
            raise ValueError('Unexpected maintenance branch')
        if inventory(root, parents[1]) != expected:
            raise ValueError('Merge changed maintenance tree')
    return expected


def classify(root, *, event, repository, ref, before, reviewed, candidate):
    if (event, repository, ref, before) != ('push', 'bechirobob/tickets', 'refs/heads/main', BASE):
        return False
    verify_tree(root, reviewed, candidate)
    if git(root, 'rev-parse', 'HEAD').decode().strip() != candidate:
        raise ValueError('Checkout differs from event')
    if git(root, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Dirty checkout')
    return True


def main():
    try:
        matches = classify(Path.cwd(), event=os.environ.get('GITHUB_EVENT_NAME', ''),
                           repository=os.environ.get('GITHUB_REPOSITORY', ''), ref=os.environ.get('GITHUB_REF', ''),
                           before=os.environ.get('RECOVERY_BEFORE', ''), reviewed=os.environ.get('RECOVERY_MAINTENANCE_SOURCE', ''),
                           candidate=os.environ.get('GITHUB_SHA', ''))
    except (ValueError, OSError, subprocess.SubprocessError):
        matches = False  # Unknown/mixed changes retain every ordinary release gate.
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('matches=' + str(matches).lower() + '\n')
    print('Exact recovery maintenance; no application release.' if matches else 'Not exact recovery maintenance; ordinary release checks required.')


if __name__ == '__main__':
    main()
