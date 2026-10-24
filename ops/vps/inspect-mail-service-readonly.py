"""Read-only installed mail protocol evidence; never imports or runs mailer source."""
import ast
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import urllib.request
import urllib.error

EXPECTED_APP = '885bd1b2d97ff687fe884c86314ae9b368d4abff'
CONTAINER = 'becore-tickets-mail'
STAGE = 'preconditions'
KNOWN_KINDS = {'team_invitation', 'organizer_report', 'organizer_invitation', 'organizer_signup',
 'registration_access', 'registration_update', 'payment_confirmation', 'ticket_recovery',
 'ticket_transfer', 'waitlist_offer', 'payment_recovery', 'support_update', 'operational_alert',
 'connection_test', 'room_host_post', 'event_host_pass'}
RETENTION_SQL = "UPDATE messages SET payload=NULL WHERE status IN ('delivered','bounced','failed') AND updated_at<?"
SOURCE_READ = """import os,stat,sys
p=os.lstat('/app')
assert stat.S_ISDIR(p.st_mode) and p.st_uid==0 and not p.st_mode & 0o022
fd=os.open('/app/mailer.py',os.O_RDONLY|os.O_NOFOLLOW)
try:
 s=os.fstat(fd)
 assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode & 0o022 and s.st_size<=262144
 data=os.read(fd,262145)
 after=os.fstat(fd)
 path=os.stat('/app/mailer.py',follow_symlinks=False)
 identity=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
 assert identity(s)==identity(after)==identity(path) and len(data)==s.st_size
 sys.stdout.buffer.write(data)
finally: os.close(fd)
"""
INSPECT_FORMAT = '{{json .Id}} {{json .Image}} {{json .State.Running}} {{json .State.StartedAt}}'


def command(args, limit=262144):
    # Only fixed commands below call this function. Never return stderr to logs.
    result = subprocess.run(args, capture_output=True, timeout=15, check=True)
    if len(result.stdout) > limit:
        raise ValueError('Oversized evidence')
    return result.stdout.decode('utf-8')


def marker():
    fd = os.open('/etc/becore-tickets-mail/revision', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 80:
            raise ValueError('Untrusted revision marker')
        value = os.read(fd, 81).decode().strip()
        if not re.fullmatch('[a-f0-9]{40}', value):
            raise ValueError('Invalid revision marker')
        return value
    finally:
        os.close(fd)


def source_evidence(source):
    tree = ast.parse(source)
    values = [node.value for node in tree.body if isinstance(node, ast.Assign)
              and any(isinstance(t, ast.Name) and t.id == 'KINDS' for t in node.targets)]
    if len(values) != 1 or not isinstance(values[0], ast.Set):
        raise ValueError('Allowlist unavailable')
    kinds = ast.literal_eval(values[0])
    if len(kinds) > 100 or not all(isinstance(k, str) and re.fullmatch('[a-z_]{1,64}', k) for k in kinds):
        raise ValueError('Invalid allowlist')
    # Static syntax evidence only. It does not prove scheduling, execution, erasure,
    # SQLite WAL/backup/spool retention, or bounds on nonterminal payload retention.
    retention = ast.parse("db.execute(" + repr(RETENTION_SQL) + ", (time.time() - 7 * 86400,))").body[0].value
    match = any(ast.dump(node) == ast.dump(retention) for node in ast.walk(tree))
    return {'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
            'known_supported_kinds': sorted(kinds & KNOWN_KINDS),
            'unknown_kind_count': len(kinds - KNOWN_KINDS),
            'room_host_post_supported': 'room_host_post' in kinds,
            'event_host_pass_supported': 'event_host_pass' in kinds,
            'historical_terminal_payload_clear_after_7_days_syntax_present': match,
            'retention_runtime_verified': False}


def identity():
    raw = command(['docker', 'inspect', '--type=container', '--format', INSPECT_FORMAT, CONTAINER], 4096)
    values = json.loads('[' + ','.join(raw.strip().split(' ')) + ']')
    if (len(values) != 4 or not re.fullmatch('[a-f0-9]{64}', values[0])
            or not re.fullmatch('sha256:[a-f0-9]{64}', values[1]) or values[2] is not True
            or not isinstance(values[3], str) or not re.fullmatch(r'[0-9TZ:.+-]{1,40}', values[3])):
        raise ValueError('Invalid container identity')
    return values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        raise ValueError('Health redirect refused')


def health():
    request = urllib.request.Request('http://127.0.0.1:8826/healthz', headers={'Cache-Control': 'no-cache'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=10) as response:
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            raise ValueError('Invalid health response')
        value = json.loads(raw)
    if (not isinstance(value, dict) or value.get('service') != 'becore-tickets-mail'
            or not isinstance(value.get('revision'), str) or not re.fullmatch('[a-f0-9]{40}', value['revision'])
            or not isinstance(value.get('sendingEnabled'), bool)):
        raise ValueError('Invalid health metadata')
    return {k: value[k] for k in ('service', 'revision', 'sendingEnabled')}


def main():
    global STAGE
    STAGE = 'preconditions'
    if os.geteuid() != 0:
        raise ValueError('Requires existing host operator context')
    fd = os.open('/run/lock/becore-tickets-deploy.lock', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
            raise ValueError('Invalid existing deployment lock')
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        props = dict(line.split('=', 1) for line in command(['systemctl', 'show', 'becore-tickets.service',
                     '--property=ActiveState,WorkingDirectory'], 4096).splitlines())
        if props != {'ActiveState': 'active', 'WorkingDirectory': '/srv/becore-tickets/releases/' + EXPECTED_APP}:
            raise ValueError('Application revision changed')
        STAGE = 'container'
        before = identity()
        STAGE = 'revision_marker'
        revision = marker()
        STAGE = 'health'
        before_health = health()
        STAGE = 'source'
        evidence = source_evidence(command(['docker', 'exec', CONTAINER, 'python3', '-B', '-c', SOURCE_READ]))
        STAGE = 'stability_recheck'
        after_health = health()
        if before != identity() or revision != marker() or before_health != after_health or revision != after_health['revision']:
            raise ValueError('Service changed during inspection')
        print(json.dumps({'read_only': True, 'app_revision': EXPECTED_APP, 'mail_revision': revision,
              'container_id': before[0], 'image_id': before[1], 'health': after_health,
              **evidence, 'messages_sent': 0, 'databases_opened': 0, 'secrets_read': 0,
              'routing_changed': False}, sort_keys=True))
    finally:
        os.close(fd)


def safe_failure(error):
    result = {'read_only': True, 'ok': False, 'stage': STAGE,
              'category': 'validation_failed'}
    if isinstance(error, urllib.error.HTTPError):
        result['category'] = 'http_error'
        if isinstance(error.code, int) and 100 <= error.code <= 599:
            result['http_status'] = error.code
    elif isinstance(error, subprocess.CalledProcessError):
        result['category'] = 'command_failed'
        if isinstance(error.returncode, int) and -128 <= error.returncode <= 255:
            result['command_exit_code'] = error.returncode
    elif isinstance(error, (subprocess.TimeoutExpired, TimeoutError)):
        result['category'] = 'timeout'
    elif isinstance(error, FileNotFoundError):
        result['category'] = 'not_found'
    elif isinstance(error, PermissionError):
        result['category'] = 'permission_denied'
    elif isinstance(error, urllib.error.URLError):
        result['category'] = 'network_error'
    elif isinstance(error, BlockingIOError):
        result['category'] = 'lock_busy'
    return result


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(safe_failure(error), sort_keys=True), file=sys.stderr)
        sys.exit(1)
