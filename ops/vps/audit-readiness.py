"""Bounded, read-only Tickets readiness observation; never emit customer or secret values."""
import datetime
import contextlib
import fcntl
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import time
import urllib.request
import urllib.error

SERVICE = 'becore-tickets.service'
STATE = Path('/var/lib/becore-tickets')
HOME = Path('/srv/becore-tickets')
MAX_RELEASE_ENTRIES = 128
SYSTEMD_UNITS = Path('/etc/systemd/system')
# Identical in reviewed active 4ec84f8645e237596129669205565eb214b6e09e and
# candidate 531ff7afb6035cc691a6428c86c4ee45b06dc14a. Never load expected hashes
# from the host being attested.
RETENTION_SHA256 = {
    'retention.py': '2df470525d55bc8d69a3c45402e28a12a9b17dfa66f2eb477789cb207a043134',
    'becore-tickets-retention.service': '89a312bbe7c96886530c05f0a253dbc388dd5bcb3696bbb79e11489aef84379b',
    'becore-tickets-retention.timer': '94d560a6cbe162529ee750e7fb67d987c5dbd62fe5a898f1476efb97bbfc1699',
}
RETENTION_FILE_LABELS = {'retention.py': 'script', 'becore-tickets-retention.service': 'service',
                         'becore-tickets-retention.timer': 'timer'}
RETENTION_UNIT_FIELDS = {
    'service': ('Id', 'LoadState', 'FragmentPath', 'SourcePath', 'DropInPaths', 'NeedDaemonReload', 'Transient',
                'Type', 'ExecStart', 'ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStop', 'ExecStopPost', 'ExecReload'),
    'timer': ('Id', 'LoadState', 'FragmentPath', 'SourcePath', 'DropInPaths', 'NeedDaemonReload', 'Transient', 'Unit'),
}
RETENTION_EMPTY_EXEC_ARRAYS = ('ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStop', 'ExecStopPost', 'ExecReload')
RETENTION_LOAD_STATES = {'loaded', 'not-found', 'error', 'bad-setting', 'masked', 'merged', 'stub', 'unknown'}
RETENTION_FAILURE_STAGES = (
    {'pointer_metadata', 'pointer_path', 'pointer_recheck', 'policy_result'}
    | {f'{unit}_{phase}_{step}' for unit in ('service', 'timer') for phase in ('before', 'after')
       for step in ('query', 'bound', 'shape')}
    | {f'{file}_{step}' for file in ('script', 'service', 'timer')
       for step in ('root_safety', 'parent_safety', 'file_open', 'file_metadata', 'file_bound_mode',
                    'file_read', 'file_size_stability', 'parent_recheck', 'file_recheck')}
)
SECRET_NAMES = ('STAFF_LOGIN_DECOY_SECRET', 'SEEV_CHECKOUT_API_KEY', 'SEEV_WEBHOOK_SECRET',
                'PAYSTACK_SECRET_KEY', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET',
                'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY')


def configuration_summary(values):
    return {'present': {key: bool(values.get(key)) for key in SECRET_NAMES},
            'production': values.get('ENVIRONMENT') == 'production',
            'seev_enabled': values.get('SEEV_ENABLED') == 'true',
            'seev_production': values.get('SEEV_ENVIRONMENT') == 'production',
            'crypto_enabled': values.get('SEEV_CRYPTO_ENABLED') == 'true'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, 'Redirect refused', headers, fp)


def resend_domain_summary(values):
    # Official GET /domains metadata only. Never send email or enumerate recipients.
    # A send-only key may reject this read; that is an explicit unknown, not a failure
    # of email delivery or a reason to broaden credentials.
    result = {'domain': 'becoreops.com', 'status': 'unverified', 'quota_verified': False,
              'actual_delivery_tested': False}
    if not values.get('RESEND_API_KEY'):
        result['reason'] = 'credential_missing'
        return result
    if not re.fullmatch(r'BeCore Tickets <tickets@becoreops\.com>|tickets@becoreops\.com', values.get('EMAIL_FROM', '')):
        result['reason'] = 'configured_sender_differs'
        return result
    request = urllib.request.Request('https://api.resend.com/domains?limit=100',
        headers={'Authorization': 'Bearer ' + values['RESEND_API_KEY'], 'User-Agent': 'BeCoreTicketsReadOnlyAudit/1.0'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise ValueError('Bound exceeded')
            data = json.loads(raw)
        domains = data.get('data')
        if not isinstance(domains, list):
            raise ValueError('Unexpected shape')
        match = next((item for item in domains if isinstance(item, dict) and item.get('name') == 'becoreops.com'), None)
        if match:
            status = match.get('status')
            result['status'] = status if status in ('pending','verified','failed','not_started','partially_verified','partially_failed','temporary_failure') else 'unknown'
            result['reason'] = 'provider_metadata'
        else:
            result['reason'] = 'not_in_bounded_page' if data.get('has_more') else 'domain_not_listed'
    except urllib.error.HTTPError as error:
        result['reason'] = 'metadata_access_denied' if error.code in (401,403) else 'provider_http_error'
        result['http_status'] = error.code
    except Exception:
        result['reason'] = 'metadata_unavailable'
    return result


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=15).strip()


def small_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(fd)
        assert stat.S_ISREG(metadata.st_mode) and metadata.st_size <= 1048576
        return json.loads(os.read(fd, 1048577))
    finally:
        os.close(fd)


def release_retention_metadata():
    """Stat-only snapshot of fixed release paths; never inspect release contents."""
    now = time.time()
    releases = HOME / 'releases'
    assert releases.resolve(strict=True) == releases
    assert stat.S_ISDIR(releases.lstat().st_mode)
    pointers, links = {}, {}
    for name in ('current', 'previous'):
        pointer = HOME / name
        assert stat.S_ISLNK(pointer.lstat().st_mode)
        links[name] = os.readlink(pointer)
        target = Path(links[name])
        if not target.is_absolute():
            target = HOME / target
        assert target.parent == releases and re.fullmatch('[a-f0-9]{40}', target.name)
        assert stat.S_ISDIR(target.lstat().st_mode) and target.resolve(strict=True) == target
        pointers[name] = target.name

    inventory = []
    # Bound all directory entries, including ignored names; never open child files.
    with os.scandir(releases) as entries:
        for count, entry in enumerate(entries):
            assert count < MAX_RELEASE_ENTRIES
            if not re.fullmatch('[a-f0-9]{40}', entry.name):
                continue
            metadata = entry.stat(follow_symlinks=False)
            if not stat.S_ISDIR(metadata.st_mode):
                continue
            inventory.append({
                'revision': entry.name, 'resolved_path': str(releases / entry.name),
                'mtime_epoch': metadata.st_mtime,
                'mtime_utc': datetime.datetime.fromtimestamp(metadata.st_mtime, datetime.timezone.utc).isoformat(),
                'age_seconds': now - metadata.st_mtime,
            })
    by_revision = {item['revision']: item for item in inventory}
    assert all(revision in by_revision for revision in pointers.values())
    assert all(os.readlink(HOME / name) == links[name] for name in pointers)
    for item in inventory:
        # Equal mtimes depend on directory iteration order in retention.py. Report
        # uncertainty at the cutoff instead of inventing a deterministic tie-break.
        newer = sum(other['mtime_epoch'] > item['mtime_epoch'] for other in inventory)
        tied = sum(other['mtime_epoch'] == item['mtime_epoch'] for other in inventory)
        item['newest_rank_min'] = newer + 1
        item['newest_rank_max'] = newer + tied
        item['pointer_names'] = [name for name, revision in pointers.items() if revision == item['revision']]
        item['within_47h_release_guard'] = item['age_seconds'] < 47 * 3600
        item['older_than_48h_retention_grace'] = item['age_seconds'] > 48 * 3600
        item['protected_now'] = True if item['pointer_names'] or newer + tied <= 3 else (None if newer < 3 else False)
        # The new release occupies one newest-three slot; current becomes previous.
        item['protected_after_one_newer_release_and_pointer_rotation'] = (
            True if item['revision'] == pointers['current'] or newer + tied <= 2
            else (None if newer < 2 else False))
    return {
        'observed_at': datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat(),
        'metadata_only': True, 'snapshot_atomic': False, 'host_retention_policy_verified': False,
        'policy_model': 'repository retention.py: current, previous, newest three; unprotected age > 48h',
        'projection_assumption': 'one strictly newer release; current becomes previous; other mtimes and directories unchanged',
        'null_protection_means': 'mtime tie crosses newest-three cutoff',
        'pointers': {name: by_revision[revision] for name, revision in pointers.items()},
        'both_pointers_within_47h_release_guard': all(by_revision[revision]['within_47h_release_guard'] for revision in pointers.values()),
        'release_count': len(inventory), 'entry_limit': MAX_RELEASE_ENTRIES,
        'directories': sorted(inventory, key=lambda item: (-item['mtime_epoch'], item['revision'])),
    }


class RetentionAttestationError(AssertionError):
    pass


def report_readiness_failure(error):
    message = 'Read-only Tickets readiness observation stopped; sensitive details suppressed.'
    if isinstance(error, RetentionAttestationError):
        stage = error.args[0] if len(error.args) == 1 else None
        if isinstance(stage, str) and stage in RETENTION_FAILURE_STAGES:
            message += ' Retention attestation stage: ' + stage + '.'
    print(message, file=sys.stderr)
    diagnostics = getattr(error, 'unit_diagnostics', None) if isinstance(error, RetentionAttestationError) else None
    if not isinstance(diagnostics, dict):
        return
    safe = {}
    for unit, fields in RETENTION_UNIT_FIELDS.items():
        for phase in ('before', 'after'):
            label = unit + '_' + phase
            item = diagnostics.get(label)
            if not isinstance(item, dict) or set(item) != {'present', 'matches_expected', 'malformed_count', 'duplicate_count', 'unexpected_count', 'load_state', 'load_state_parseable'}:
                continue
            if any(not isinstance(item[key], dict) or set(item[key]) != set(fields)
                   or any(type(value) is not bool for value in item[key].values()) for key in ('present', 'matches_expected')):
                continue
            if any(type(item[key]) is not int or not 0 <= item[key] <= 16384
                   for key in ('malformed_count', 'duplicate_count', 'unexpected_count')):
                continue
            if type(item['load_state_parseable']) is not bool or type(item['load_state']) is not str or item['load_state'] not in RETENTION_LOAD_STATES:
                continue
            safe[label] = item
    if safe:
        print('Retention unit metadata: ' + json.dumps(safe, sort_keys=True), file=sys.stderr)


def retention_policy_attestation():
    stage = ['pointer_metadata', {}]
    try:
        return _retention_policy_attestation(stage)
    except Exception:
        # Only our finite stage vocabulary can escape; never format the cause.
        error = RetentionAttestationError(stage[0])
        error.unit_diagnostics = stage[1]
        raise error from None


def _retention_policy_attestation(stage):
    """Hash only the three fixed policy files; suppress contents and raw unit data."""
    def identity(metadata, directory=False):
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')
        if not directory:
            fields += ('st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')
        return tuple(getattr(metadata, field) for field in fields)

    pointer = HOME / 'current'
    pointer_stat = pointer.lstat()
    assert stat.S_ISLNK(pointer_stat.st_mode) and pointer_stat.st_uid == 0
    stage[0] = 'pointer_path'
    link = os.readlink(pointer)
    target = Path(link) if Path(link).is_absolute() else HOME / link
    assert target.parent == HOME / 'releases' and re.fullmatch('[a-f0-9]{40}', target.name)
    paths = {'retention.py': target / 'operations' / 'retention.py',
             **{name: SYSTEMD_UNITS / name for name in RETENTION_SHA256 if name != 'retention.py'}}
    units = ('becore-tickets-retention.service', 'becore-tickets-retention.timer')
    properties = {name: ','.join(RETENTION_UNIT_FIELDS[RETENTION_FILE_LABELS[name]]) for name in units}

    def unit_metadata(phase):
        result = {}
        failed_stage = None
        for name in units:
            label = RETENTION_FILE_LABELS[name] + '_' + phase
            stage[0] = label + '_query'
            raw = run('systemctl', 'show', name, '--no-pager', '--all', '--property=' + properties[name])
            stage[0] = label + '_bound'
            assert len(raw) <= 16384
            stage[0] = label + '_shape'
            pairs = [line.split('=', 1) for line in raw.splitlines()]
            parsed = [pair for pair in pairs if len(pair) == 2]
            keys = [key for key, value in parsed]
            values = dict(parsed)
            fields = RETENTION_UNIT_FIELDS[RETENTION_FILE_LABELS[name]]
            expected = {'Id': name, 'LoadState': 'loaded', 'FragmentPath': str(SYSTEMD_UNITS / name),
                        'SourcePath': '', 'DropInPaths': '', 'NeedDaemonReload': 'no', 'Transient': 'no'}
            if name == units[0]:
                expected.update(Type='oneshot', ExecStartPre='', ExecStartPost='', ExecCondition='', ExecStop='', ExecStopPost='', ExecReload='')
            else:
                expected['Unit'] = units[0]
            matches = {key: keys.count(key) == 1 and values[key] == value for key, value in expected.items()}
            if name == units[0]:
                matches['ExecStart'] = keys.count('ExecStart') == 1 and bool(re.fullmatch(
                    r'\{ path=/usr/bin/python3 ; argv\[\]=' + re.escape('/usr/bin/python3 ' + str(HOME / 'current/operations/retention.py'))
                    + r' ; ignore_errors=no ; [^{}]* \}', values['ExecStart']))
            stage[1][label] = {
                'present': {key: key in values for key in fields}, 'matches_expected': matches,
                'malformed_count': len(pairs) - len(parsed), 'duplicate_count': len(keys) - len(values),
                'unexpected_count': sum(key not in fields for key in keys),
                'load_state_parseable': keys.count('LoadState') == 1,
                'load_state': values['LoadState'] if keys.count('LoadState') == 1 and values['LoadState'] in RETENTION_LOAD_STATES else 'unknown',
            }
            # systemd v255 systemctl-show.c's Exec* array printer emits nothing
            # for zero commands, even with --all. Normalize only these six empty
            # hooks; keep their raw presence above and require every other field.
            optional_empty = set(RETENTION_EMPTY_EXEC_ARRAYS) if name == units[0] else set()
            try:
                assert all(len(pair) == 2 for pair in pairs)
                assert len(values) == len(pairs) and not set(values) - set(fields)
                assert set(fields) - set(values) <= optional_empty
            except AssertionError:
                failed_stage = failed_stage or stage[0]
                continue
            for key in optional_empty:
                values.setdefault(key, '')
            result[name] = values
        if failed_stage:
            stage[0] = failed_stage
            raise AssertionError
        return result

    before_units = unit_metadata('before')
    files = {}
    # Open every directory component without following symlinks, then keep its
    # descriptor until the bounded read and path/inode rechecks have completed.
    with contextlib.ExitStack() as stack:
        directory_checks, file_checks = [], []
        for name, path in paths.items():
            label = RETENTION_FILE_LABELS[name]
            stage[0] = label + '_root_safety'
            directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            stack.callback(os.close, directory)
            metadata = os.fstat(directory)
            assert metadata.st_uid == 0 and not stat.S_IMODE(metadata.st_mode) & 0o7022
            for component in path.parts[1:-1]:
                stage[0] = label + '_parent_safety'
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                stack.callback(os.close, child)
                metadata = os.fstat(child)
                assert stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0
                assert not stat.S_IMODE(metadata.st_mode) & 0o7022
                directory_checks.append((directory, component, identity(metadata, True), label))
                directory = child
            stage[0] = label + '_file_open'
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            stack.callback(os.close, fd)
            stage[0] = label + '_file_metadata'
            metadata = os.fstat(fd)
            assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1
            stage[0] = label + '_file_bound_mode'
            assert not stat.S_IMODE(metadata.st_mode) & 0o7022 and metadata.st_size <= 16384
            content = bytearray()
            stage[0] = label + '_file_read'
            while len(content) <= 16384:
                chunk = os.read(fd, 16385 - len(content))
                if not chunk:
                    break
                content.extend(chunk)
            stage[0] = label + '_file_size_stability'
            assert len(content) == metadata.st_size and len(content) <= 16384
            digest = hashlib.sha256(content).hexdigest()
            files[name] = {'path': str(path), 'sha256': digest, 'matches_reviewed': digest == RETENTION_SHA256[name],
                           'uid': metadata.st_uid, 'gid': metadata.st_gid, 'mode': oct(stat.S_IMODE(metadata.st_mode)),
                           'size_bytes': metadata.st_size}
            file_checks.append((fd, directory, path.name, identity(metadata), label))
        after_units = unit_metadata('after')
        for parent, component, expected, label in directory_checks:
            stage[0] = label + '_parent_recheck'
            assert identity(os.stat(component, dir_fd=parent, follow_symlinks=False), True) == expected
        for fd, parent, name, expected, label in file_checks:
            stage[0] = label + '_file_recheck'
            assert identity(os.fstat(fd)) == expected
            assert identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) == expected
        stage[0] = 'pointer_recheck'
        assert identity(pointer.lstat()) == identity(pointer_stat) and os.readlink(pointer) == link

    stage[0] = 'policy_result'
    unit_checks = {}
    for name in units:
        values = after_units[name]
        unit_checks[name] = {
            'metadata_stable': before_units[name] == values,
            'loaded_identity_matches': all(values[key] == expected for key, expected in {
                'Id': name, 'LoadState': 'loaded', 'FragmentPath': str(SYSTEMD_UNITS / name),
                'SourcePath': '', 'DropInPaths': '', 'NeedDaemonReload': 'no', 'Transient': 'no'}.items()),
        }
    service = after_units[units[0]]
    expected_exec = '/usr/bin/python3 ' + str(HOME / 'current/operations/retention.py')
    unit_checks[units[0]]['execution_matches'] = (
        service['Type'] == 'oneshot'
        and all(service[key] == '' for key in ('ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStop', 'ExecStopPost', 'ExecReload'))
        and bool(re.fullmatch(r'\{ path=/usr/bin/python3 ; argv\[\]=' + re.escape(expected_exec)
                             + r' ; ignore_errors=no ; [^{}]* \}', service['ExecStart'])))
    unit_checks[units[1]]['service_target_matches'] = after_units[units[1]]['Unit'] == units[0]
    verified = all(item['matches_reviewed'] for item in files.values()) and all(all(checks.values()) for checks in unit_checks.values())
    return {'read_only': True, 'snapshot_atomic': False, 'current_revision': target.name,
            'scope': 'fixed policy file hashes and loaded unit identity; no guarantee against later changes',
            'files': files, 'unit_checks': unit_checks, 'unit_metadata': stage[1],
            'host_retention_policy_verified': verified}


def inspect_database(path, application=False):
    assert path.is_file() and not path.is_symlink()
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5)
    deadline = time.monotonic() + 15
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
    try:
        db.execute('PRAGMA query_only=ON')
        result = {'quick_check_ok': db.execute('PRAGMA quick_check').fetchone()[0] == 'ok',
                  'foreign_key_violations': sum(1 for _ in db.execute('PRAGMA foreign_key_check'))}
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if application:
            result['active_owner_count'] = db.execute("SELECT count(*) FROM staff_accounts WHERE role='owner' AND status='active'").fetchone()[0] if 'staff_accounts' in tables else None
            result['owner_update_guard_present'] = bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='staff_last_active_owner_update_guard' AND tbl_name='staff_accounts'").fetchone())
            counts = {}
            for table, statuses in {
                'delivery_events': ('queued', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed'),
                'confirmation_deliveries': ('pending', 'processing', 'email', 'push', 'completed'),
                'system_alerts': ('open', 'acknowledged', 'resolved'),
                'payment_refunds': ('pending', 'processing', 'processed', 'failed'),
                'orders': ('payment_pending', 'paid', 'failed', 'cancelled', 'expired', 'requires_refund', 'refund_pending', 'refunded', 'disputed'),
                'provider_operation_records': ('pending', 'completed', 'closed_unpaid'),
                'event_announcement_campaigns': ('queued', 'sending', 'completed', 'failed'),
                'marketing_campaigns': ('queued', 'sending', 'sent', 'failed'),
            }.items():
                if table in tables:
                    counts[table] = {s: db.execute(f'SELECT count(*) FROM {table} WHERE status=?', (s,)).fetchone()[0] for s in statuses}
                    counts[table]['total'] = db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
            result['counts'] = counts
            result['jobs'] = []
            if 'background_job_health' in tables:
                for key in ('scheduled:minute', 'scheduled:five-minute', 'delivery-loop'):
                    row = db.execute('SELECT started_at,finished_at,last_success_at,last_failure_at,failure_count FROM background_job_health WHERE job_key=?', (key,)).fetchone()
                    result['jobs'].append({'job': key, 'observed': bool(row), **(dict(zip(('started_at','finished_at','last_success_at','last_failure_at','failure_count'), row)) if row else {})})
        elif 'delivery_queue' in tables:
            result['queued'] = db.execute('SELECT count(*) FROM delivery_queue').fetchone()[0]
            result['overdue'] = db.execute('SELECT count(*) FROM delivery_queue WHERE available<? AND (lease IS NULL OR lease<?)', (int(time.time()*1000)-300000, int(time.time()*1000))).fetchone()[0]
        return result
    finally:
        db.close()


def main():
    assert os.geteuid() == 0
    signal.alarm(120)
    lock = os.open('/run/lock/becore-tickets-deploy.lock', os.O_RDONLY | os.O_NOFOLLOW)
    fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
    props = dict(line.split('=', 1) for line in run('systemctl', 'show', SERVICE, '--property=ActiveState,WorkingDirectory,User,MainPID,NRestarts,MemoryCurrent').splitlines())
    active = Path(props['WorkingDirectory'])
    assert active.parent == HOME / 'releases' and re.fullmatch('[a-f0-9]{40}', active.name)
    assert props['ActiveState'] == 'active' and props['User'] == 'becore-tickets'
    pid = props['MainPID']; assert re.fullmatch('[1-9][0-9]*', pid)
    env = dict(x.split(b'=', 1) for x in (Path('/proc') / pid / 'environ').read_bytes().split(b'\0') if b'=' in x)
    assert env.get(b'TICKETS_STATE') == str(STATE).encode()
    assert env.get(b'TICKETS_CONFIG') == b'/run/becore-tickets-runtime/runtime.json'
    for config_path in (Path('/etc/becore-tickets/runtime.json'), Path('/run/becore-tickets-runtime/runtime.json')):
        metadata = config_path.lstat()
        assert stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) == 0o600
    canonical = small_json(Path('/etc/becore-tickets/runtime.json'))
    effective = small_json(Path('/run/becore-tickets-runtime/runtime.json'))
    assert effective == canonical
    output = {'read_only': True, 'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'revision': active.name, 'service_active': True, 'restarts': int(props['NRestarts']),
              'memory_bytes': int(props['MemoryCurrent']), 'free_disk_bytes': shutil.disk_usage(HOME).free,
              'configuration': configuration_summary(effective),
              'backup_key_private_present': False}
    key = Path('/etc/becore-tickets/backup.key').lstat()
    output['backup_key_private_present'] = stat.S_ISREG(key.st_mode) and key.st_size == 32 and not key.st_mode & 0o077
    output['backup_escrow_currently_verified'] = False  # Requires separate Cloudflare secret metadata check, never key export.
    release_metadata = release_retention_metadata()
    pointers = {name: item['revision'] for name, item in release_metadata['pointers'].items()}
    assert pointers['current'] == active.name
    output['release_pointers'] = pointers
    output['release_retention_metadata'] = release_metadata
    output['retention_policy_attestation'] = retention_policy_attestation()
    assert output['retention_policy_attestation']['current_revision'] == pointers['current']
    release_metadata['host_retention_policy_verified'] = output['retention_policy_attestation']['host_retention_policy_verified']
    origin_path = Path('/etc/caddy/becore-tickets-origin.caddy')
    origin_fd = os.open(origin_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        assert stat.S_ISREG(os.fstat(origin_fd).st_mode) and os.fstat(origin_fd).st_size <= 65536
        origin = os.read(origin_fd, 65537).decode('utf-8')
    finally:
        os.close(origin_fd)
    output['origin_file'] = {
        'sha256': hashlib.sha256(origin.encode()).hexdigest(),
        'cloudflare_source_allowlist_present': '@blocked not remote_ip ' in origin and 'respond @blocked 403' in origin,
        'forwarded_for_from_cloudflare': 'header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}' in origin,
        'real_ip_from_cloudflare': 'header_up X-Real-IP {http.request.header.Cf-Connecting-Ip}' in origin,
        'cf_connecting_ip_explicitly_set_or_removed': bool(re.search(r'header_up\s+[+-]?Cf-Connecting-Ip\b', origin, re.I)),
        'request_body_directive': bool(re.search(r'\brequest_body\b', origin)),
        'max_size_directive': bool(re.search(r'\bmax_size\b', origin)),
        'runtime_loaded_config_verified': False,
    }
    output['retention'] = dict(line.split('=', 1) for line in run('systemctl','show','becore-tickets-retention.timer','--property=ActiveState,UnitFileState,NextElapseUSecRealtime').splitlines())
    offhost = small_json(Path('/var/backups/becore-tickets/offhost.json'))
    filename = offhost.get('filename', '')
    assert re.fullmatch(r'tickets-[0-9TZ.:-]+\.tar\.gz\.enc', filename)
    output['offhost'] = {k: offhost.get(k) for k in ('runId','encrypted','restoreTested','retentionDays')}
    output['offhost']['captured_filename'] = filename
    output['database'] = inspect_database(STATE / 'tickets.sqlite', True)
    output['operations'] = inspect_database(STATE / 'operations.sqlite')
    req = urllib.request.Request('http://127.0.0.1:3119/healthz', headers={'Host':'tickets.becoreops.com'})
    with urllib.request.urlopen(req, timeout=10) as response:
        health = json.loads(response.read(65536))
        assert response.status == 200 and health.get('active') is True and health.get('revision') == active.name
    output['local_health_ok'] = True
    output['sending_domain'] = resend_domain_summary(effective)
    print(json.dumps(output, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        report_readiness_failure(error)
        sys.exit(1)
