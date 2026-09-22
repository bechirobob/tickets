"""Install the isolated static fallback; preserve all existing Caddy sites. Root only."""
import fcntl
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

def run(*args):
    result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError(f'Command failed: {args[0]} {args[1]}')

def atomic(path, content, mode=0o644):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def install(source, revision):
    if os.geteuid() != 0 or not re.fullmatch('[a-f0-9]{40}', revision):
        raise RuntimeError('Root access and a full source revision are required.')
    with open('/run/lock/becore-caddy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        main = pathlib.Path('/etc/caddy/Caddyfile')
        original = main.read_bytes()
        unit = subprocess.check_output(['systemctl', 'show', 'caddy', '-p', 'ExecStart'], text=True)
        if '/etc/caddy/Caddyfile' not in unit:
            raise RuntimeError('Caddy uses a different configuration; no services changed.')
        root = pathlib.Path('/srv/becore-tickets-fallback')
        release = root / 'releases' / revision
        release.mkdir(parents=True, exist_ok=True, mode=0o755)
        for name in ('index.html', 'monitor.py', 'activate-monitor.py', 'becore-tickets-fallback.service', 'becore-tickets-fallback.timer'):
            data = (source / name).read_bytes()
            if name == 'index.html' and b'__BRAND_IMAGE__' in data:
                raise RuntimeError('Fallback page was not built.')
            atomic(release / name, data)
        snippet = pathlib.Path('/etc/caddy/becore-tickets-fallback.caddy')
        previous_snippet = snippet.read_bytes() if snippet.exists() else None
        current = root / 'current'
        previous_target = os.readlink(current) if current.is_symlink() else None
        if current.exists() and not current.is_symlink():
            raise RuntimeError('Fallback current path is not a symlink; nothing replaced.')
        backup = pathlib.Path('/var/backups/becore-tickets-fallback') / (str(time.time_ns()) + '-' + revision[:12])
        backup.mkdir(parents=True, mode=0o700)
        atomic(backup / 'Caddyfile', original, 0o600)
        if previous_snippet is not None: atomic(backup / 'fallback.caddy', previous_snippet, 0o600)
        atomic(backup / 'previous-target', (previous_target or '').encode(), 0o600)
        import_line = b'import /etc/caddy/becore-tickets-fallback.caddy'
        if b'tickets-status.becoreops.com' in original:
            raise RuntimeError('Fallback site already exists inline; no shared configuration overwritten.')
        candidate = original if import_line in original.splitlines() else original.rstrip() + b'\n\n' + import_line + b'\n'
        changed_main = False
        try:
            temporary_link = root / ('current-' + revision[:12])
            temporary_link.symlink_to(release)
            os.replace(temporary_link, current)
            atomic(snippet, (source / 'Caddyfile').read_bytes())
            candidate_path = main.parent / 'becore-tickets-candidate.conf'
            atomic(candidate_path, candidate)
            run('caddy', 'validate', '--config', str(candidate_path), '--adapter', 'caddyfile')
            candidate_path.unlink()
            if main.read_bytes() != original:
                raise RuntimeError('Caddy configuration changed during preparation; no shared configuration overwritten.')
            atomic(main, candidate)
            changed_main = True
            run('systemctl', 'reload', 'caddy')
            run('systemctl', 'is-active', '--quiet', 'caddy')
        except Exception:
            if changed_main and main.read_bytes() == candidate: atomic(main, original)
            if previous_snippet is None: snippet.unlink(missing_ok=True)
            else: atomic(snippet, previous_snippet)
            current.unlink(missing_ok=True)
            if previous_target: current.symlink_to(previous_target)
            if changed_main: run('systemctl', 'reload', 'caddy')
            raise
        # Units are installed but deliberately inactive until the private connection is configured.
        for name in ('becore-tickets-fallback.service', 'becore-tickets-fallback.timer'):
            atomic(pathlib.Path('/etc/systemd/system') / name, (release / name).read_bytes())
        run('systemctl', 'daemon-reload')
        print('Fallback page installed:', revision)
        print('Existing Caddy sites preserved. Rollback snapshot:', backup)
        print('Page SHA-256:', hashlib.sha256((release / 'index.html').read_bytes()).hexdigest())
        print('Automatic switching was not enabled by this installer.')

if __name__ == '__main__':
    install(pathlib.Path(sys.argv[1]).resolve(), sys.argv[2])
