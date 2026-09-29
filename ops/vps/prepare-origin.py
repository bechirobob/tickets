"""Prepare a strict-TLS, maintenance-only Tickets origin. Never changes DNS."""
import grp
import json
import os
import pathlib
import subprocess
import urllib.request
import urllib.error

HOST = 'tickets.becoreops.com'
ZONE = 'bbf0174f839a0d22dbf6d9f4bd3cf53d'


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Origin preparation command failed: ' + args[0])
    return result.stdout


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root access required.')
    os.umask(0o077)
    credentials = pathlib.Path('/etc/becore-tickets-fallback.env')
    if credentials.is_symlink() or credentials.stat().st_mode & 0o077:
        raise RuntimeError('Private operator configuration required.')
    values = dict(line.split('=', 1) for line in credentials.read_text().splitlines() if '=' in line and not line.startswith('#'))
    token = values['CLOUDFLARE_API_TOKEN'].strip().strip('\"\'')

    def api(path, method='GET', body=None):
        request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
            method=method, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError('Origin certificate API access failed (HTTP ' + str(error.code) + ').') from None
        if not payload.get('success'):
            raise RuntimeError('Origin certificate API operation failed.')
        return payload['result']

    ssl = api('/zones/' + ZONE + '/settings/ssl')
    if ssl['value'] != 'strict':
        raise RuntimeError('Strict origin TLS must be configured for this hostname before activation; no zone setting changed.')
    directory = pathlib.Path('/etc/caddy/certs/becore-tickets')
    parent_was_missing = not directory.parent.exists()
    directory.mkdir(parents=True, exist_ok=True, mode=0o750)
    os.chmod(directory, 0o750)
    group = grp.getgrnam('caddy').gr_gid
    os.chown(directory, 0, group)
    if parent_was_missing:
        os.chown(directory.parent, 0, group)
        os.chmod(directory.parent, 0o750)
    key = directory / 'origin.key'
    csr = directory / 'origin.csr'
    certificate = directory / 'origin.pem'
    receipt = directory / 'certificate.json'
    if not key.exists():
        run('openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', str(key))
    if key.is_symlink() or certificate.is_symlink():
        raise RuntimeError('Certificate files must not be symlinks.')
    run('openssl', 'req', '-new', '-key', str(key), '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=DNS:' + HOST, '-out', str(csr))
    if not certificate.exists():
        result = api('/certificates', 'POST', {'hostnames': [HOST], 'request_type': 'origin-rsa', 'requested_validity': 365, 'csr': csr.read_text()})
        certificate.write_text(result['certificate'])
        receipt.write_text(json.dumps({'id': result['id'], 'expiresOn': result['expires_on'], 'hostname': HOST}))
    run('openssl', 'x509', '-in', str(certificate), '-checkhost', HOST, '-noout')
    run('openssl', 'x509', '-in', str(certificate), '-checkend', '2592000', '-noout')
    for file in [key, certificate]:
        os.chown(file, 0, group)
        os.chmod(file, 0o640)
    block = pathlib.Path('/etc/caddy/becore-tickets-origin.caddy')
    expected = HOST + ' {\n    tls ' + str(certificate) + ' ' + str(key) + '\n    header Cache-Control "no-store"\n    header Retry-After "60"\n    respond "Tickets host is being prepared." 503\n}\n'
    if block.exists() and block.read_text() != expected:
        raise RuntimeError('Existing origin route requires inspection; not overwritten.')
    main_config = pathlib.Path('/etc/caddy/Caddyfile')
    original = main_config.read_text()
    directive = 'import /etc/caddy/becore-tickets-origin.caddy'
    block.write_text(expected)
    os.chmod(block, 0o644)
    changed = directive not in original.splitlines()
    if changed:
        main_config.write_text(original.rstrip() + '\n' + directive + '\n')
    try:
        run('caddy', 'validate', '--config', str(main_config))
        run('systemctl', 'reload', 'caddy')
    except Exception:
        if changed:
            main_config.write_text(original)
        raise
    print(json.dumps({'originPrepared': True, 'hostname': HOST, 'mode': 'maintenance-only', 'strictTls': True, 'dnsChanged': False, 'certificate': json.loads(receipt.read_text())}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Origin preparation failed; inspect private host state.')
        raise SystemExit(1)
