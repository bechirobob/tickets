"""Verify the real SMTP queue and DKIM signer without transmitting any email.

Run inside the container as root, only while sending is disabled. A dedicated
header rule holds this fixture in Postfix; the exact queue entry is then removed.
"""
import email
from email.utils import formatdate
import re
import smtplib
import subprocess
from pathlib import Path
import uuid

assert not Path('/control/sending-enabled').exists(), 'Run this check only before activation.'

def run(*args, data=None):
    result = subprocess.run(args, input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} verification failed (exit {result.returncode}).')
    return result.stdout

previous = run('postconf', '-h', 'header_checks').decode().strip()
assert not previous, 'Do not overwrite an existing header-check policy.'
fixture = 'fixture-' + uuid.uuid4().hex
rule = Path('/run/tickets-smoke.rules')
rule.write_text('/^X-Tickets-Connection-Test: ' + fixture + '$/ HOLD connection-verification\n')
rule.chmod(0o644)
queue_id = None
try:
    run('postconf', '-e', 'header_checks=regexp:' + str(rule))
    run('postfix', 'reload')
    content = ('From: BeCore Tickets <tickets@becoreops.com>\r\n'
               'To: fixture@example.invalid\r\n'
               'Subject: Local signing verification\r\n'
               'Date: ' + formatdate(usegmt=True) + '\r\n'
               'Message-ID: <' + fixture + '@mail.becoreops.com>\r\n'
               'X-Tickets-Connection-Test: ' + fixture + '\r\n\r\n'
               'Local fixture. This message must never leave the server.\r\n').encode()
    with smtplib.SMTP('127.0.0.1', 25, timeout=10) as client:
        client.ehlo('mail.becoreops.com')
        assert client.mail('tickets@becoreops.com')[0] == 250
        assert client.rcpt('fixture@example.invalid')[0] == 250
        code, result = client.data(content)
        assert code == 250, 'Local SMTP handoff was rejected.'
        match = re.search(rb'queued as ([A-Z0-9]+)', result)
        assert match, 'Local SMTP did not return a queue ID.'
        queue_id = match[1].decode()
    queued = run('postcat', '-bh', '-q', queue_id)
    parsed = email.message_from_bytes(queued)
    dkim = parsed.get('DKIM-Signature', '')
    assert 'd=becoreops.com' in dkim and 's=ticketsvps202609' in dkim, 'The running signer did not sign the fixture.'
    run('opendkim-testmsg', data=queued)
    print('SMTP queue acceptance and published DKIM signature verified. No email transmitted.')
finally:
    if queue_id:
        run('postsuper', '-d', queue_id)
    run('postconf', '-e', 'header_checks=' + previous)
    run('postfix', 'reload')
    rule.unlink(missing_ok=True)
