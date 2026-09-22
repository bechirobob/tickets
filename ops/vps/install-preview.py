"""Install a verified release on loopback only. No DNS, Caddy or production writes."""
import fcntl
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import sys
import urllib.request


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def install(source, revision):
    if os.geteuid() != 0 or not re.fullmatch('[a-f0-9]{40}', revision):
        raise RuntimeError('Root access and an exact revision are required.')
    manifest = json.loads((source / 'release.json').read_text())
    if manifest.get('revision') != revision or manifest.get('dirty') is not False:
        raise RuntimeError('Release identity does not match verified source.')
    with open('/run/lock/becore-tickets-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        root = pathlib.Path('/srv/becore-tickets')
        root.mkdir(mode=0o755, exist_ok=True)
        for name in ('releases', 'temporary'):
            (root / name).mkdir(mode=0o755, exist_ok=True)
        release = root / 'releases' / revision
        if release.exists():
            if (release / 'release.json').read_bytes() != (source / 'release.json').read_bytes():
                raise RuntimeError('Existing release has a different identity.')
        else:
            shutil.copytree(source, release, symlinks=True)
        try:
            account = pwd.getpwnam('becore-tickets')
        except KeyError:
            run('useradd', '--system', '--home-dir', '/var/lib/becore-tickets-preview', '--shell', '/usr/sbin/nologin', 'becore-tickets')
            account = pwd.getpwnam('becore-tickets')
        state = pathlib.Path('/var/lib/becore-tickets-preview')
        state.mkdir(mode=0o700, exist_ok=True)
        os.chown(state, account.pw_uid, account.pw_gid)
        configuration = pathlib.Path('/etc/becore-tickets')
        configuration.mkdir(mode=0o750, exist_ok=True)
        os.chown(configuration, 0, account.pw_gid)
        config = configuration / 'preview.json'
        if not config.exists():
            descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as output:
                json.dump({'ENVIRONMENT': 'preview'}, output)
            os.chown(config, account.pw_uid, account.pw_gid)
        journal = pathlib.Path('/etc/systemd/journald@becore-tickets.conf.d')
        journal.mkdir(mode=0o755, parents=True, exist_ok=True)
        shutil.copyfile(source / 'operations/journal-limits.conf', journal / 'limits.conf')
        for name in ('becore-tickets-preview.service', 'becore-tickets-retention.service', 'becore-tickets-retention.timer'):
            shutil.copyfile(source / 'operations' / name, pathlib.Path('/etc/systemd/system') / name)
        run('systemctl', 'daemon-reload')
        current = root / 'current'
        previous = current.resolve() if current.is_symlink() else None
        if current.exists() and not current.is_symlink():
            raise RuntimeError('Current release must be a symlink.')
        temporary = root / 'next'
        if temporary.is_symlink():
            temporary.unlink()
        temporary.symlink_to(release)
        os.replace(temporary, current)
        try:
            subprocess.run(['runuser', '-u', 'becore-tickets', '--', 'node', 'operations/initialize-preview.mjs'], cwd=release, check=True)
            run('systemctl', 'enable', '--now', 'becore-tickets-preview.service', 'becore-tickets-retention.timer')
            run('systemctl', 'restart', 'becore-tickets-preview.service')
            import time
            for attempt in range(30):
                try:
                    request = urllib.request.Request('http://127.0.0.1:3118/healthz', headers={'Host': 'tickets.becoreops.com'})
                    with urllib.request.urlopen(request, timeout=3) as response:
                        health = json.load(response)
                    if health['revision'] == revision and health['active'] is False:
                        break
                except Exception:
                    time.sleep(1)
            else:
                raise RuntimeError('Isolated service did not become ready.')
        except Exception:
            if previous:
                temporary.symlink_to(previous)
                os.replace(temporary, current)
                run('systemctl', 'restart', 'becore-tickets-preview.service')
            else:
                run('systemctl', 'stop', 'becore-tickets-preview.service')
            raise
        if previous and previous != release:
            rollback = root / 'previous'
            if rollback.is_symlink():
                rollback.unlink()
            rollback.symlink_to(previous)
        print(json.dumps({'service': 'becore-tickets-preview', 'revision': revision, 'ready': True, 'active': False, 'publicRoutingChanged': False}))


if __name__ == '__main__':
    install(pathlib.Path(sys.argv[1]).resolve(), sys.argv[2])
