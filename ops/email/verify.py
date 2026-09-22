"""Read-only connection verification; sends no mail and prints no secrets."""
import hashlib
import hmac
import json
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import urllib.error

HOST = 'mail.becoreops.com'
IP = '51.195.20.137'
ROOT = Path('/etc/becore-tickets-mail')
key = (ROOT / 'api.key').read_bytes().strip()


def request(path, value=None, signed=False):
    headers = {}
    body = json.dumps(value).encode() if value is not None else None
    if signed:
        timestamp = str(int(time.time()))
        canonical = f'{timestamp}\nPOST\n{path}\n{hashlib.sha256(body).hexdigest()}'.encode()
        headers = {'Content-Type': 'application/json', 'x-tickets-timestamp': timestamp, 'x-tickets-signature': hmac.new(key, canonical, hashlib.sha256).hexdigest()}
    try:
        with urllib.request.urlopen(urllib.request.Request('https://' + HOST + path, data=body, headers=headers), timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, {}


# New DNS names may have a negative cache entry; allow propagation and ACME.
for attempt in range(60):
    try:
        address = socket.gethostbyname(HOST)
        status, health = request('/healthz')
        if address == IP and status == 200:
            break
    except (OSError, ValueError):
        pass
    if attempt == 59:
        raise RuntimeError('Public DNS and HTTPS are not ready; sending remains disabled.')
    time.sleep(5)
report = {'a': address}
try:
    report['ptr'] = socket.gethostbyaddr(IP)[0].rstrip('.')
except OSError:
    report['ptr'] = None
report['reverseDnsReady'] = report['ptr'] == HOST and report['a'] == IP
status, health = request('/healthz')
report['https'] = status
report['health'] = health
report['unsignedSend'] = request('/v1/emails', {})[0]
report['signedStatus'] = request('/v1/status', {'ids': ['vps-' + '0' * 64]}, True)[0]
if not health.get('sendingEnabled'):
    report['pausedSend'] = request('/v1/emails', {'from': 'BeCore Tickets <tickets@becoreops.com>', 'to': 'fixture@example.invalid', 'subject': 'Connection verification', 'html': '<p>Fixture</p>', 'text': 'Fixture', 'idempotencyKey': 'connection-paused-verification', 'kind': 'connection_test'}, True)[0]
result = subprocess.run(['docker', 'exec', 'becore-tickets-mail', 'opendkim-testkey', '-d', 'becoreops.com', '-s', 'ticketsvps202609', '-k', '/run/opendkim/tickets.private'], capture_output=True)
report['dkimPublishedKeyMatches'] = result.returncode == 0
result = subprocess.run(['docker', 'exec', 'becore-tickets-mail', 'postconf', '-h', 'inet_interfaces'], capture_output=True)
report['smtpInterfaces'] = result.stdout.decode().strip()
result = subprocess.run(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', 'becore-tickets-mail'], capture_output=True)
report['publishedPorts'] = json.loads(result.stdout)
report['readyForOwnerDeliveryTest'] = bool(report['reverseDnsReady'] and status == 200 and report['dkimPublishedKeyMatches'] and report['unsignedSend'] == 401 and report['signedStatus'] == 200)
print(json.dumps(report, indent=2))
assert status == 200 and report['unsignedSend'] == 401 and report['signedStatus'] == 200
assert health.get('sendingEnabled') or report['pausedSend'] == 503
assert report['smtpInterfaces'] == 'loopback-only'
assert report['dkimPublishedKeyMatches']
