"""Classify one independently reviewed BeCore Tickets main push before Cloudflare writes."""

import os
import re
import subprocess
from pathlib import Path


REPOSITORY = 'bechirobob/tickets'
MAIN = 'refs/heads/main'
CONTROLS = frozenset({
    '.github/workflows/deploy.yml',
    'ops/vps/box_office_standby_boundary.py',
    'ops/vps/code-release.py',
    'ops/vps/test_box_office_standby_boundary.py',
    'ops/vps/recovery_maintenance_test_support.py',
    'ops/vps/test_audit_readiness.py',
    'ops/vps/test_code_release.py',
    'tests/browser-environment.test.mjs',
})
SHA = re.compile(r'[a-f0-9]{40}\Z')


class BoundaryError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise BoundaryError(message)


def git(root, *args, statuses=(0,)):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0')
    result = subprocess.run(['git', '--no-replace-objects', *args], cwd=root,
                            capture_output=True, env=env, timeout=60)
    require(result.returncode in statuses, 'Box Office standby Git verification failed.')
    return result


def ancestor(root, base, head):
    return git(root, 'merge-base', '--is-ancestor', base, head, statuses=(0, 1)).returncode == 0


def tree(root, revision):
    entries = {}
    for record in git(root, 'ls-tree', '-r', '-z', '--full-tree', revision).stdout.split(b'\0'):
        if record:
            meta, path = record.split(b'\t', 1)
            mode, kind, blob = meta.decode('ascii').split()
            entries[path.decode('utf-8')] = (mode, kind, blob)
    return entries


def changed_paths(before, after):
    return {path for path in before.keys() | after.keys() if before.get(path) != after.get(path)}


def allow_cloudflare(root, *, repository, ref, event, before, head, base, base_tree, snapshot, snapshot_tree):
    """Only an exact first Box Office push defers standby. Intended drift fails closed."""
    require((repository, ref, event) == (REPOSITORY, MAIN, 'push'),
            'Box Office standby gate expects a canonical main push.')
    require(all(isinstance(x, str) and SHA.fullmatch(x) for x in (before, head, base, base_tree, snapshot, snapshot_tree)),
            'Box Office standby requires immutable revisions.')
    require(len({before, head, snapshot}) == 3 and before != '0' * 40,
            'Box Office standby requires distinct nonempty revisions.')
    require(git(root, 'rev-parse', 'HEAD').stdout.decode().strip() == head and
            not git(root, 'status', '--porcelain', '--untracked-files=all').stdout and ancestor(root, before, head),
            'Box Office standby checkout does not match an ordinary clean main push.')
    require(git(root, 'rev-parse', base + '^{tree}').stdout.decode().strip() == base_tree,
            'Box Office standby live baseline tree differs.')
    base_entries, before_entries = tree(root, base), tree(root, before)
    pending_release = (ancestor(root, base, before) and
                       changed_paths(base_entries, before_entries) == CONTROLS)
    available = git(root, 'cat-file', '-e', snapshot + '^{commit}', statuses=(0, 128)).returncode == 0
    first_snapshot_push = available and ancestor(root, snapshot, head) and not ancestor(root, snapshot, before)
    if not (pending_release or first_snapshot_push):
        return True

    require(pending_release and first_snapshot_push,
            'Expected independently reviewed Box Office merge is missing or drifted; standby untouched.')
    require(git(root, 'rev-parse', snapshot + '^{tree}').stdout.decode().strip() == snapshot_tree
            and ancestor(root, base, snapshot), 'Box Office standby reviewed snapshot differs.')
    snapshot_entries = tree(root, snapshot)
    require(CONTROLS.isdisjoint(changed_paths(base_entries, snapshot_entries)),
            'Box Office application snapshot is not separate from controls.')
    require(all(before_entries.get(path, (None, None))[0:2] == ('100644', 'blob') for path in CONTROLS),
            'Box Office standby control files must be reviewed regular blobs.')
    expected = {**snapshot_entries, **{path: before_entries[path] for path in CONTROLS}}
    require(tree(root, head) == expected, 'Box Office standby merge tree differs from exact review.')
    return False


def main():
    try:
        allowed = allow_cloudflare(Path.cwd(), repository=os.environ['GITHUB_REPOSITORY'],
            ref=os.environ['GITHUB_REF'], event=os.environ['GITHUB_EVENT_NAME'],
            before=os.environ['BECORE_PUSH_BEFORE'], head=os.environ['GITHUB_SHA'],
            base=os.environ['BECORE_BOX_BASE'], base_tree=os.environ['BECORE_BOX_BASE_TREE'],
            snapshot=os.environ['BECORE_BOX_SNAPSHOT'], snapshot_tree=os.environ['BECORE_BOX_SNAPSHOT_TREE'])
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'allow_cloudflare={str(allowed).lower()}\n')
        print('Existing Cloudflare path.' if allowed else 'Exact Box Office VPS-only release; Cloudflare untouched.')
    except (BoundaryError, KeyError, OSError, subprocess.TimeoutExpired, ValueError) as exc:
        print(str(exc) if isinstance(exc, BoundaryError) else 'Box Office standby verification failed; Cloudflare untouched.')
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
