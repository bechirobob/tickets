"""Install Tickets mail in an isolated container; never enable live sending."""
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('/etc/becore-tickets-mail')
CONTAINER = 'becore-tickets-mail'
HOST = 'mail.becoreops.com'
IP = '51.195.20.137'


def run(*args, capture=False):
    result = subprocess.run(args, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f'Command failed: {args[0]} {args[1]} (exit {result.returncode}).')
    return result.stdout if capture else None


def atomic(path, data, mode=0o600):
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def connection():
    source = Path('/etc/becore-tickets-fallback.env')
    if not source.is_file():
        raise RuntimeError('The existing Tickets Cloudflare connection is unavailable.')
    return dict(line.split('=', 1) for line in source.read_text().splitlines() if '=' in line)


def api(path, method='GET', value=None):
    token = connection()['CLOUDFLARE_API_TOKEN']
    body = json.dumps(value).encode() if value is not None else None
    request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path, data=body, method=method, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Cloudflare request failed (HTTP {error.code}).') from None
    if not data.get('success'):
        raise RuntimeError('Cloudflare did not accept the configuration.')
    return data['result']


def configure_dns():
    zone = api('/zones/' + connection()['CLOUDFLARE_ZONE_ID'])
    base = '/zones/' + zone['id'] + '/dns_records'
    public = run('openssl', 'pkey', '-in', str(ROOT / 'dkim.private'), '-pubout', '-outform', 'DER', capture=True)
    key = 'v=DKIM1; k=rsa; p=' + base64.b64encode(public).decode()
    for name, kind, content in [(HOST, 'A', IP), ('ticketsvps202609._domainkey.becoreops.com', 'TXT', key)]:
        records = api(base + '?name=' + urllib.parse.quote(name))
        matching = [item for item in records if item['type'] == kind]
        if records:
            existing = matching[0]['content'] if matching else None
            if kind == 'TXT' and existing and existing.startswith('"'):
                existing = ''.join(shlex.split(existing))
            if len(matching) != 1 or existing != content or matching[0].get('proxied'):
                raise RuntimeError('An existing mail DNS record differs; no record overwritten.')
        else:
            record = {'type': kind, 'name': name, 'content': content, 'ttl': 300, 'comment': 'BeCore Tickets transactional mail on Hermes.'}
            if kind == 'A':
                record['proxied'] = False
            api(base, 'POST', record)
    records = api(base + '?name=becoreops.com&type=TXT')
    spf = [item for item in records if item['content'].strip('"').startswith('v=spf1 ')]
    if len(spf) != 1:
        raise RuntimeError('Exactly one existing SPF record is required; no SPF record changed.')
    content = spf[0]['content'].strip('"')
    if 'ip4:' + IP not in content.split():
        parts = content.split()
        if not re.fullmatch(r'[~?+-]?all', parts[-1]):
            raise RuntimeError('SPF policy needs manual review; no SPF record changed.')
        parts.insert(-1, 'ip4:' + IP)
        api(base + '/' + spf[0]['id'], 'PATCH', {'content': ' '.join(parts)})
    # Store the connection only; the provider-selection flag remains unchanged.
    api('/accounts/' + zone['account']['id'] + '/workers/scripts/becore-tickets/secrets', 'PUT', {
        'name': 'VPS_EMAIL_SIGNING_KEY', 'type': 'secret_text', 'text': (ROOT / 'api.key').read_text().strip(),
    })
    print('Mail hostname, dedicated DKIM key and SPF authorization configured. Existing email providers preserved.')
    print('Worker mail credential stored privately; provider selection unchanged.')


def configure_caddy(source, revision):
    with open('/run/lock/becore-caddy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        main = Path('/etc/caddy/Caddyfile')
        original = main.read_bytes()
        snippet = Path('/etc/caddy/becore-tickets-mail.caddy')
        previous = snippet.read_bytes() if snippet.exists() else None
        include = b'import /etc/caddy/becore-tickets-mail.caddy'
        if HOST.encode() in original:
            raise RuntimeError('Mail hostname already exists inline in Caddy; no shared configuration overwritten.')
        candidate = original if include in original.splitlines() else original.rstrip() + b'\n\n' + include + b'\n'
        backup = Path('/var/backups/becore-tickets-mail') / f'{time.time_ns()}-{revision[:12]}'
        backup.mkdir(parents=True, mode=0o700)
        atomic(backup / 'Caddyfile', original)
        if previous:
            atomic(backup / 'mail.caddy', previous)
        changed = False
        candidate_path = Path('/etc/caddy/becore-mail-candidate.conf')
        try:
            atomic(snippet, (source / 'Caddyfile').read_bytes(), 0o644)
            atomic(candidate_path, candidate, 0o644)
            run('caddy', 'validate', '--config', str(candidate_path), '--adapter', 'caddyfile')
            if main.read_bytes() != original:
                raise RuntimeError('Shared Caddy configuration changed concurrently.')
            atomic(main, candidate, 0o644)
            changed = True
            run('systemctl', 'reload', 'caddy')
        except Exception:
            if changed and main.read_bytes() == candidate:
                atomic(main, original, 0o644)
            if previous is None:
                snippet.unlink(missing_ok=True)
            else:
                atomic(snippet, previous, 0o644)
            if changed:
                run('systemctl', 'reload', 'caddy')
            raise
        finally:
            candidate_path.unlink(missing_ok=True)
        print('Mail HTTPS route configured; all existing Caddy sites preserved.')


def install(source, revision):
    if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Root access and a full release revision are required.')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    if not (ROOT / 'api.key').is_file():
        atomic(ROOT / 'api.key', secrets.token_hex(32).encode())
    if not (ROOT / 'dkim.private').is_file():
        run('openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(ROOT / 'dkim.private'))
        (ROOT / 'dkim.private').chmod(0o600)
    state = Path('/var/lib/becore-tickets-mail')
    state.mkdir(mode=0o700, exist_ok=True)
    control = ROOT / 'control'
    control.mkdir(mode=0o755, exist_ok=True)
    logs = Path('/var/log/becore-tickets-mail')
    logs.mkdir(mode=0o750, exist_ok=True)
    image = CONTAINER + ':' + revision
    build = subprocess.run(['docker', 'build', '--quiet', '--tag', image, str(source)], capture_output=True)
    if build.returncode:
        # The build context contains only public source; secrets are runtime mounts.
        print(build.stderr.decode(errors='replace')[-8000:])
        raise RuntimeError('Mail image build failed; the existing service is unchanged.')
    inspected = json.loads(run('docker', 'image', 'inspect', image, capture=True))[0]
    print('Mail image built:', inspected['Id'])
    old = subprocess.run(['docker', 'inspect', CONTAINER], capture_output=True)
    old_image = json.loads(old.stdout)[0]['Image'] if old.returncode == 0 else None
    atomic(ROOT / 'previous-image', (old_image or '').encode())
    if old_image:
        run('docker', 'stop', '--time', '30', CONTAINER)
        run('docker', 'rename', CONTAINER, CONTAINER + '-previous')
    args = ['docker', 'run', '-d', '--name', CONTAINER, '--restart', 'unless-stopped', '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--security-opt', 'no-new-privileges:true',
            '--publish', '127.0.0.1:8826:8826', '--env', 'RELEASE_SHA=' + revision,
            '--mount', 'type=bind,src=' + str(ROOT) + ',dst=/secrets,readonly',
            '--mount', 'type=bind,src=' + str(control) + ',dst=/control,readonly',
            '--mount', 'type=bind,src=' + str(state) + ',dst=/data',
            '--mount', 'type=bind,src=' + str(logs) + ',dst=/mail-log',
            '--mount', 'type=volume,src=becore-tickets-mail-spool,dst=/var/spool/postfix',
            '--tmpfs', '/run:rw,nosuid,nodev,size=16m', image]
    try:
        run(*args)
        ready = False
        for _ in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8826/healthz', timeout=2) as response:
                    health = json.load(response)
                if health.get('revision') == revision:
                    ready = True
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        if not ready:
            raise RuntimeError('Mail container did not become healthy. Inspect its configuration before retrying.')
        configure_dns()
        configure_caddy(source, revision)
    except Exception:
        # Preserve failed diagnostics privately; restore the exact previous container.
        diagnostic = subprocess.run(['docker', 'logs', '--tail', '100', CONTAINER], capture_output=True)
        atomic(ROOT / 'last-install.log', diagnostic.stdout + diagnostic.stderr)
        subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
        if old_image:
            run('docker', 'rename', CONTAINER + '-previous', CONTAINER)
            run('docker', 'start', CONTAINER)
            print('Previous mail container restored.')
        raise
    if old_image:
        run('docker', 'rm', CONTAINER + '-previous')
    atomic(ROOT / 'revision', revision.encode())
    print('Mail service prepared:', revision)
    print('Live sending enabled:', control.joinpath('sending-enabled').is_file())


if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve(), sys.argv[2])
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else f'Mail setup failed: {type(error).__name__}.')
        raise SystemExit(1)
