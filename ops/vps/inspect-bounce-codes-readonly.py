"""Bounded read-only historical bounce-code inspection; no sends or mutations."""
import contextlib
import fcntl
import importlib.util
import hashlib
import subprocess
import datetime
import json
import os
from pathlib import Path
import re
import pwd
import sys
import sqlite3
import stat
import time

# The reviewed workflow may supply this module in memory to avoid remote writes.
if 'tickets_mail_metadata' in sys.modules:
    metadata = sys.modules['tickets_mail_metadata']
else:
    spec = importlib.util.spec_from_file_location('tickets_mail_metadata', Path(__file__).with_name('inspect-mail-service-readonly.py'))
    metadata = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(metadata)

EXPECTED_MAIL = 'dc8355093f42cb00501d9f587e494b25811af884'
EXPECTED_SOURCE = 'fea4874c1877a4c227302c8030da6d4f6b2855450de27a7362f021d854e40c5b'
MAIL_UID = 10000  # Fixed Dockerfile/start.sh UID; never infer it from a secret file.
SLUG = 'puro-exceso-20261024'
CREATED = '2026-10-24T11:24:04.728Z'
OCT19_START = '2026-10-19T00:00:00Z'
OCT20_START = '2026-10-20T00:00:00Z'
EXPECTED_EVENT_TIMES = {'2026-10-19T16:37:01.928Z', '2026-10-19T22:51:01.769Z',
                        '2026-10-19T22:51:12.027Z', '2026-10-19T22:51:36.859Z'}
APP_DB = Path('/var/lib/becore-tickets/tickets.sqlite')
MAIL_DB = Path('/var/lib/becore-tickets-mail/outbox.sqlite')
LOG_PATHS = (Path('/var/log/becore-tickets-mail/mail.log'), Path('/var/log/becore-tickets-mail/mail.log.1'))
MAX_BYTES = 16 * 1024 * 1024  # Shared cap across both files, never a tail-only guess.
MAX_LINE = 16384
TIME_LIMIT = 15
COHORT_SQL = """SELECT DISTINCT a.attendee_id,r.normalized_email AS recipient
      FROM attendee_notifications n JOIN ticket_assignments a ON a.attendee_id=n.attendee_id AND a.status='active'
      JOIN tickets t ON t.id=a.ticket_id AND t.event_slug=n.event_slug AND t.status IN ('issued','checked_in')
      JOIN orders o ON o.id=t.order_id AND o.status='paid' AND o.payment_provider='rsvp'
      JOIN attendee_profiles p ON p.id=a.attendee_id AND p.status='active'
      JOIN event_registrations r ON r.order_id=o.id AND r.event_slug=t.event_slug AND r.attendee_id=a.attendee_id
        AND r.status='confirmed' AND r.kind='rsvp' AND (r.device_claimed_at IS NOT NULL OR r.verified_at IS NOT NULL)
        AND r.normalized_email=o.customer_email
      JOIN event_registration_settings settings ON settings.event_slug=t.event_slug AND settings.room_access=1
      JOIN curated_event_records e ON e.slug=t.event_slug AND e.removed_at IS NULL AND e.archived_at IS NULL
        AND e.status IN ('published','scheduled') AND e.schedule_status='confirmed' AND e.event_state NOT IN ('cancelled','postponed')
      JOIN room_host_first_posts receipt ON receipt.event_slug=n.event_slug AND receipt.message_id=n.source_id AND receipt.cancelled_at IS NULL
      WHERE n.event_slug=? AND n.kind='host_first_post' AND n.source_id=? AND receipt.created_at=?
        AND a.attendee_id<>receipt.sender_attendee_id
        AND NOT EXISTS(SELECT 1 FROM room_suspensions s WHERE s.event_slug=t.event_slug AND s.attendee_id=a.attendee_id AND s.restored_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM room_blocks b WHERE b.event_slug=t.event_slug AND b.blocker_attendee_id=a.attendee_id AND b.blocked_attendee_id=receipt.sender_attendee_id)
        AND NOT EXISTS(SELECT 1 FROM notification_preferences f WHERE f.event_slug=t.event_slug AND f.attendee_id=a.attendee_id AND (f.host_updates=0 OR f.muted_until>?))
        AND NOT EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.attendee_id=a.attendee_id AND s.revoked_at IS NULL AND s.host_updates=1)
        AND NOT EXISTS(SELECT 1 FROM marketing_contacts m WHERE m.email=r.normalized_email AND m.unsubscribed=1)
        AND NOT EXISTS(SELECT 1 FROM event_audience_contacts c WHERE c.event_slug=t.event_slug AND c.email=r.normalized_email AND c.unsubscribed_at IS NOT NULL AND c.unsubscribed_at>=COALESCE(c.consented_at,''))
        AND EXISTS(SELECT 1 FROM delivery_events d WHERE d.recipient=r.normalized_email AND d.status='bounced')
        AND NOT EXISTS(SELECT 1 FROM delivery_events d WHERE d.recipient=r.normalized_email AND d.status='complained')
        AND NOT EXISTS(SELECT 1 FROM delivery_events d WHERE d.id='room-first-email/'||receipt.message_id||'/'||a.attendee_id AND d.status<>'suppressed')
        AND EXISTS(SELECT 1 FROM staff_accounts host JOIN staff_event_assignments assigned ON assigned.account_id=host.id
          JOIN attendee_profiles sender ON sender.normalized_email=host.normalized_email AND sender.status='active' AND sender.email_verified_at IS NOT NULL
          WHERE host.id=receipt.host_account_id AND sender.id=receipt.sender_attendee_id AND assigned.event_slug=receipt.event_slug
            AND host.status='active' AND host.role='organizer' AND host.must_change_password=0 AND (host.locked_until IS NULL OR host.locked_until<=?))
      ORDER BY a.attendee_id LIMIT 5"""


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')


def select_provider_ids(db, with_evidence=False):
    receipts = db.execute("SELECT message_id FROM room_host_first_posts WHERE event_slug=? AND created_at=? AND cancelled_at IS NULL AND fanout_at IS NOT NULL LIMIT 2", (SLUG, CREATED)).fetchall()
    if len(receipts) != 1:
        raise ValueError('Original receipt ambiguous')
    stamp = now()
    cohort = db.execute(COHORT_SQL, (SLUG, receipts[0][0], CREATED, stamp, stamp)).fetchall()
    if len(cohort) != 4 or len({r[0] for r in cohort}) != 4 or len({r[1] for r in cohort}) != 4:
        raise ValueError('Current suppressed cohort differs')
    ids = []; event_times = set()
    for _, contact in cohort:
        rows = db.execute("SELECT provider_id,COALESCE(provider_event_at,updated_at) FROM delivery_events WHERE recipient=? AND status IN ('bounced','complained') ORDER BY COALESCE(provider_event_at,updated_at) DESC,id DESC LIMIT 2", (contact,)).fetchall()
        if not rows:
            raise ValueError('Historical provider count differs')
        # The private owner report identified the latest event, not the contact's
        # entire failure history. Older records do not make that event ambiguous.
        if len(rows)>1 and rows[0][1]==rows[1][1]:
            raise ValueError('Historical latest event tied')
        if not isinstance(rows[0][0], str) or not re.fullmatch(r'vps-[a-f0-9]{64}', rows[0][0]):
            raise ValueError('Historical provider format differs')
        if rows[0][1] not in EXPECTED_EVENT_TIMES:
            raise ValueError('Historical event timestamp changed')
        event_times.add(rows[0][1])
        ids.append(rows[0][0])
    if len(set(ids)) != 4 or event_times != EXPECTED_EVENT_TIMES:
        raise ValueError('Provider evidence overlaps')
    evidence=tuple((row[0],row[1],ident) for row,ident in zip(cohort,ids))
    return (tuple(ids),evidence) if with_evidence else tuple(ids)


def select_queue_ids(db, provider_ids, with_evidence=False):
    if len(provider_ids) != 4 or len(set(provider_ids)) != 4 or not all(re.fullmatch(r'vps-[a-f0-9]{64}', p) for p in provider_ids):
        raise ValueError('Invalid private receipt set')
    rows = db.execute('SELECT id,queue_id,status,updated_at FROM messages WHERE id IN (?,?,?,?)', provider_ids).fetchall()
    if len(rows) != 4 or {r[0] for r in rows} != set(provider_ids):
        raise ValueError('Outbox evidence missing')
    start = datetime.datetime(2026,10,19,tzinfo=datetime.timezone.utc).timestamp()
    queues = set()
    for _, queue, status, updated in rows:
        if status != 'bounced' or not isinstance(queue, str) or not re.fullmatch(r'[A-Z0-9]{5,32}', queue) or not isinstance(updated,(int,float)) or not start <= updated < start+86400:
            raise ValueError('Unexpected outbox evidence')
        queues.add(queue)
    if len(queues) != 4:
        raise ValueError('Queue evidence overlaps')
    return (queues,tuple(sorted(tuple(row) for row in rows))) if with_evidence else queues


def readonly_authorizer(action, arg1, arg2, _db, _source):
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_TRANSACTION}
    return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY


def safe_file(path, owners, max_size=None):
    # Every ancestor must already be a directory, not a symlink or writable by others.
    for parent in reversed(path.parents):
        item = parent.lstat()
        if not stat.S_ISDIR(item.st_mode) or item.st_mode & 0o022:
            raise ValueError('Unsafe parent path')
    item = path.lstat()
    if not stat.S_ISREG(item.st_mode):
        raise ValueError('Evidence file type differs')
    if item.st_uid not in owners:
        raise ValueError('Evidence file owner differs')
    if item.st_mode & 0o022:
        raise ValueError('Evidence file mode differs')
    if max_size is not None and item.st_size > max_size:
        raise ValueError('Evidence file size exceeds bound')
    return item


@contextlib.contextmanager
def readonly_db(path, owners):
    if path not in (APP_DB, MAIL_DB):
        raise ValueError('Unexpected database path')
    before = safe_file(path, owners)
    # mode=ro must not create missing WAL shared-memory sidecars.
    wal, shm = Path(str(path)+'-wal'), Path(str(path)+'-shm')
    if wal.exists() or shm.exists():
        safe_file(wal, owners)
        safe_file(shm, owners)
    db = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=3)
    deadline = time.monotonic()+TIME_LIMIT
    try:
        db.execute('PRAGMA query_only=ON')
        db.set_authorizer(readonly_authorizer)
        db.set_progress_handler(lambda: int(time.monotonic()>deadline),1000)
        db.execute('BEGIN')
        yield db
        if db.total_changes != 0 or (path.stat().st_dev,path.stat().st_ino) != (before.st_dev,before.st_ino):
            raise ValueError('Database evidence changed identity')
    finally:
        db.close()


def parse_line(line, queues):
    # Only unambiguous RFC3339 Oct19 UTC lines are accepted. Legacy syslog lacks
    # year/timezone: classify as unknown instead of guessing an October window.
    timestamp = re.match(r'^(2026-10-19T[0-9:.]+(?:Z|\+00:00))\s', line)
    if not timestamp:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(timestamp[1].replace('Z','+00:00'))
    except ValueError:
        return None
    if parsed.date() != datetime.date(2026,10,19):
        return None
    match = re.search(r'\bpostfix/smtp\[\d+\]: ([A-Z0-9]{5,32}): ', line)
    if not match or match[1] not in queues or not re.search(r'\bstatus=bounced(?:\s|$)',line):
        return None
    dsn = re.findall(r'\bdsn=([245]\.[0-9]{1,3}\.[0-9]{1,3})(?=[,\s])',line)
    # Require explicit remote SMTP-reply introducer; never mistake IPs, ports,
    # timestamps, byte counts or queue IDs for response codes.
    smtp = re.findall(r'\bsaid: ([245][0-9]{2})(?=[ -])',line)
    if len(dsn) > 1 or len(smtp) > 1:
        return None
    return match[1], dsn[0] if dsn else None, smtp[0] if smtp else None


def code_category(dsn):
    if dsn is None or dsn == 'unknown': return 'unknown'
    if dsn.startswith('4.'): return 'transient_failure'
    if dsn.startswith('5.7.'): return 'permanent_security_or_policy'
    if dsn.startswith('5.1.'): return 'permanent_address_status'
    if dsn.startswith('5.2.'): return 'permanent_mailbox_status'
    if dsn.startswith('5.'): return 'other_permanent_failure'
    return 'other_numeric_evidence'


def scan_logs(queues, owners):
    if len(queues) != 4 or not all(re.fullmatch(r'[A-Z0-9]{5,32}',q) for q in queues):
        raise ValueError('Invalid private queue set')
    deadline=time.monotonic()+TIME_LIMIT
    evidence={q:set() for q in queues}
    used=0; available=0; missing=0; bounded_out=False
    for path in LOG_PATHS:
        if time.monotonic()>deadline:
            bounded_out=True;break
        try:
            info=safe_file(path,owners)
        except FileNotFoundError:
            missing+=1;continue
        if info.st_size>MAX_BYTES-used:
            bounded_out=True;continue
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as stream:
            opened=os.fstat(stream.fileno())
            if (opened.st_dev,opened.st_ino)!=(info.st_dev,info.st_ino):
                raise ValueError('Log replaced during opening')
            available+=1
            while True:
                if time.monotonic()>deadline or used>=MAX_BYTES:
                    bounded_out=True;break
                line=stream.readline(min(MAX_LINE+1,MAX_BYTES-used))
                if not line:break
                used+=len(line)
                if len(line)>MAX_LINE or not line.endswith(b'\n'):
                    # Do not resume in the middle of an overlong record.
                    bounded_out=True;break
                parsed=parse_line(line.decode('utf-8',errors='replace'),queues)
                if parsed:evidence[parsed[0]].add(parsed[1:])
            after=os.fstat(stream.fileno())
            current=path.lstat()
            if (current.st_dev,current.st_ino)!=(opened.st_dev,opened.st_ino):
                raise ValueError('Log rotated during inspection')
            if (after.st_size,after.st_mtime_ns)!=(opened.st_size,opened.st_mtime_ns):
                raise ValueError('Log changed during inspection')
    groups={};known=0;ambiguous=0
    for values in evidence.values():
        if len(values)>1:
            ambiguous+=1;continue
        if not values:continue
        dsn,smtp=next(iter(values))
        if dsn is None and smtp is None:continue
        key=(dsn or 'unknown',smtp or 'unknown')
        groups[key]=groups.get(key,0)+1;known+=1
    return {'cohort_count':4,'messages_with_numeric_evidence':known,'ambiguous_messages':ambiguous,
            'unknown_messages':4-known,'numeric_code_groups':[{'dsn':k[0],'smtp':k[1],'category':code_category(k[0]),'count':v} for k,v in sorted(groups.items())],
            'available_log_files':available,'missing_log_files':missing,'scan_incomplete':bounded_out,
            'legacy_timestamps_not_trusted':True,'resends':0,'unsuppressions':0,'database_changes':0}


MOUNT_FORMAT = '{{range .Mounts}}{{if eq .Destination "/mail-log"}}{{json .}}{{end}}{{end}}'
CONTAINER_LOG_READER = r"""
import hashlib,json,os,stat,sys,types
stage='input'
try:
 raw=sys.stdin.buffer.read(262145)
 assert len(raw)<=262144
 packet=json.loads(raw)
 assert hashlib.sha256(packet['source'].encode()).hexdigest()==packet['source_sha256']
 stage='directory_identity'
 before=os.lstat('/mail-log')
 assert stat.S_ISDIR(before.st_mode) and before.st_uid==0 and before.st_gid==10000 and stat.S_IMODE(before.st_mode)==0o750
 assert [before.st_dev,before.st_ino]==packet['directory_identity']
 sys.modules['tickets_mail_metadata']=types.ModuleType('tickets_mail_metadata')
 namespace={'__name__':'tickets_bounce_container'}
 stage='source_load'
 exec(compile(packet['source'],'<reviewed-bounce-reader>','exec'),namespace)
 namespace['LOG_PATHS']=(namespace['Path']('/mail-log/mail.log'),namespace['Path']('/mail-log/mail.log.1'))
 stage='log_read'
 result=namespace['scan_logs'](set(packet['queues']),{0})
 stage='directory_recheck'
 after=os.lstat('/mail-log')
 assert (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid)==(after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid)
 print(json.dumps(result,sort_keys=True))
except Exception as error:
 category='not_found' if isinstance(error,FileNotFoundError) else 'permission_denied' if isinstance(error,PermissionError) else 'timeout' if isinstance(error,TimeoutError) else 'validation_failed'
 print(json.dumps({'reader_error':{'stage':stage,'category':category}},sort_keys=True))
 sys.exit(1)
"""

def mounted_log_identity():
    mount=json.loads(metadata.command(['docker','inspect','--type=container','--format',MOUNT_FORMAT,metadata.CONTAINER],4096))
    if (mount.get('Type'),mount.get('Source'),mount.get('Destination'),mount.get('RW'))!=('bind','/var/log/becore-tickets-mail','/mail-log',True):
        raise ValueError('Mail log mount differs')
    info=Path('/var/log/becore-tickets-mail').lstat()
    if not stat.S_ISDIR(info.st_mode) or (info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode))!=(0,10000,0o750):
        raise ValueError('Mail log mount directory differs')
    return info.st_dev,info.st_ino

def scan_mounted_logs(queues):
    before=mounted_log_identity()
    source=globals().get('DIAGNOSTIC_SOURCE')
    if not isinstance(source,str) or len(source.encode())>131072:
        raise ValueError('Reviewed reader source missing')
    packet={'source':source,'source_sha256':hashlib.sha256(source.encode()).hexdigest(),
            'queues':sorted(queues),'directory_identity':list(before)}
    response=subprocess.run(['docker','exec','-i',metadata.CONTAINER,'python3','-B','-c',CONTAINER_LOG_READER],
            input=json.dumps(packet).encode(),capture_output=True,timeout=20,check=False)
    if len(response.stdout)>8192 or before!=mounted_log_identity():
        raise ValueError('Mounted log evidence changed')
    try:result=json.loads(response.stdout)
    except (ValueError,UnicodeDecodeError):
        if response.returncode!=0:raise subprocess.CalledProcessError(response.returncode,response.args) from None
        raise ValueError('Invalid mounted reader output') from None
    if response.returncode!=0:
        error=ValueError('Mounted log reader stopped')
        if isinstance(result,dict) and set(result)=={'reader_error'}:
            error.safe_reader=result['reader_error']
        raise error
    expected={'cohort_count','messages_with_numeric_evidence','ambiguous_messages','unknown_messages','numeric_code_groups',
              'available_log_files','missing_log_files','scan_incomplete','legacy_timestamps_not_trusted','resends','unsuppressions','database_changes'}
    if not isinstance(result,dict) or set(result)!=expected or result['cohort_count']!=4 or any(result[k]!=0 for k in ('resends','unsuppressions','database_changes')):
        raise ValueError('Invalid mounted log result')
    for key in ('messages_with_numeric_evidence','ambiguous_messages','unknown_messages'):
        if type(result[key]) is not int or not 0<=result[key]<=4:raise ValueError('Invalid aggregate count')
    if result['messages_with_numeric_evidence']+result['unknown_messages']!=4 or result['ambiguous_messages']>result['unknown_messages']:
        raise ValueError('Invalid aggregate totals')
    if any(type(result[k]) is not int or not 0<=result[k]<=2 for k in ('available_log_files','missing_log_files')) or type(result['scan_incomplete']) is not bool or result['legacy_timestamps_not_trusted'] is not True:
        raise ValueError('Invalid aggregate metadata')
    groups=result['numeric_code_groups']
    if not isinstance(groups,list) or len(groups)>4:raise ValueError('Invalid numeric groups')
    for group in groups:
        if (not isinstance(group,dict) or set(group)!={'dsn','smtp','category','count'}
            or not isinstance(group['dsn'],str) or not re.fullmatch(r'unknown|[245]\.[0-9]{1,3}\.[0-9]{1,3}',group['dsn'])
            or not isinstance(group['smtp'],str) or not re.fullmatch(r'unknown|[245][0-9]{2}',group['smtp'])
            or group['category']!=code_category(group['dsn']) or type(group['count']) is not int or not 1<=group['count']<=4):
            raise ValueError('Invalid numeric group')
    if sum(g['count'] for g in groups)!=result['messages_with_numeric_evidence']:raise ValueError('Invalid numeric group total')
    return result


def app_identity():
    props=dict(line.split('=',1) for line in metadata.command(['systemctl','show','becore-tickets.service',
          '--property=ActiveState,WorkingDirectory'],4096).splitlines())
    if props != {'ActiveState':'active','WorkingDirectory':'/srv/becore-tickets/releases/'+metadata.EXPECTED_APP}:
        raise ValueError('Application changed')


def service_identity():
    identity=metadata.identity()
    revision=metadata.marker()
    health=metadata.health()
    source=metadata.source_evidence(metadata.command(['docker','exec',metadata.CONTAINER,'python3','-B','-c',metadata.SOURCE_READ]))
    if revision != EXPECTED_MAIL or health['revision'] != EXPECTED_MAIL or health['sendingEnabled'] is not True or source['source_sha256'] != EXPECTED_SOURCE:
        raise ValueError('Mail protocol changed')
    return identity,revision,health,source['source_sha256']


VALIDATION_CODES = {
    'Original receipt ambiguous': 'receipt_mismatch',
    'Current suppressed cohort differs': 'cohort_count_mismatch',
    'Historical provider count differs': 'provider_count_mismatch',
    'Historical latest event tied': 'latest_event_tied',
    'Historical provider format differs': 'provider_format_mismatch',
    'Historical event timestamp changed': 'event_time_mismatch',
    'Provider evidence overlaps': 'provider_overlap',
    'Invalid private receipt set': 'provider_set_invalid',
    'Outbox evidence missing': 'outbox_count_mismatch',
    'Unexpected outbox evidence': 'outbox_status_time_or_queue_mismatch',
    'Queue evidence overlaps': 'queue_overlap',
    'Unsafe parent path': 'parent_metadata_mismatch',
    'Evidence file type differs': 'file_type_mismatch',
    'Evidence file owner differs': 'file_owner_mismatch',
    'Evidence file mode differs': 'file_mode_mismatch',
    'Evidence file size exceeds bound': 'file_size_exceeded',
    'Unexpected database path': 'database_path_mismatch',
    'Database evidence changed identity': 'database_identity_changed',
}

LOG_METADATA_PATHS = (
    ('root',Path('/')),('var',Path('/var')),('var_log',Path('/var/log')),
    ('mail_log_directory',Path('/var/log/becore-tickets-mail')),
    ('mail_log',Path('/var/log/becore-tickets-mail/mail.log')),
    ('mail_log_previous',Path('/var/log/becore-tickets-mail/mail.log.1')),
)

def fixed_log_metadata():
    result=[]
    for label,path in LOG_METADATA_PATHS:
        try:info=path.lstat()
        except FileNotFoundError:
            result.append({'label':label,'exists':False});continue
        mode=stat.S_IMODE(info.st_mode)
        if any(type(v) is not int or not 0<=v<=4294967295 for v in (info.st_uid,info.st_gid)):
            raise ValueError('Invalid numeric ownership')
        kind='directory' if stat.S_ISDIR(info.st_mode) else 'regular' if stat.S_ISREG(info.st_mode) else 'symlink' if stat.S_ISLNK(info.st_mode) else 'other'
        result.append({'label':label,'exists':True,'type':kind,'mode':format(mode,'04o'),'uid':info.st_uid,'gid':info.st_gid})
    return result


def diagnostic_failure(error):
    result=metadata.safe_failure(error)
    if type(error) is ValueError and len(error.args)==1 and isinstance(error.args[0],str):
        code=VALIDATION_CODES.get(error.args[0])
        if code:result['validation_code']=code
    elif isinstance(error,sqlite3.DatabaseError):
        result['category']='database_read_error'
        code=getattr(error,'sqlite_errorcode',None)
        if isinstance(code,int) and 0<=code<=65535:result['sqlite_code']=code
    reader=getattr(error,'safe_reader',None)
    if isinstance(reader,dict) and set(reader)=={'stage','category'} and reader['stage'] in {'input','directory_identity','source_load','log_read','directory_recheck'} and reader['category'] in {'not_found','permission_denied','timeout','validation_failed'}:
        result['container_reader']=reader
    if metadata.STAGE=='bounded_logs' and result.get('validation_code') in {'parent_metadata_mismatch','file_type_mismatch','file_owner_mismatch','file_mode_mismatch'}:
        try:result['log_path_metadata']=fixed_log_metadata()
        except Exception:result['metadata_inspection_failed']=True
    return result


def private_linkage(app_uid):
    metadata.STAGE='app_file'
    with readonly_db(APP_DB,{app_uid}) as app:
        metadata.STAGE='cohort_provider_query'
        providers,cohort=select_provider_ids(app,with_evidence=True)
    metadata.STAGE='mail_file'
    with readonly_db(MAIL_DB,{MAIL_UID}) as mail:
        metadata.STAGE='queue_query'
        queues,receipts=select_queue_ids(mail,providers,with_evidence=True)
    return providers,queues,cohort,receipts


def main():
    metadata.STAGE='preconditions'
    if os.geteuid()!=0:
        raise ValueError('Requires existing host operator context')
    fd=os.open('/run/lock/becore-tickets-deploy.lock',os.O_RDONLY|os.O_NOFOLLOW)
    try:
        lock=os.fstat(fd)
        if not stat.S_ISREG(lock.st_mode) or lock.st_uid!=0:
            raise ValueError('Invalid existing deployment lock')
        fcntl.flock(fd,fcntl.LOCK_SH|fcntl.LOCK_NB)
        app_identity()
        app_uid=pwd.getpwnam('becore-tickets').pw_uid
        metadata.STAGE='mail_metadata'
        before=service_identity()
        metadata.STAGE='private_linkage'
        linkage=private_linkage(app_uid)
        queues=linkage[1]
        metadata.STAGE='bounded_logs'
        result=scan_mounted_logs(queues)
        metadata.STAGE='cohort_recheck'
        # Fresh read-only snapshots: never claim a long-lived snapshot proves
        # eligibility remained unchanged while bounded log parsing ran.
        if linkage!=private_linkage(app_uid):
            raise ValueError('Private cohort or queue linkage changed')
        metadata.STAGE='stability_recheck'
        app_identity()
        if before!=service_identity():
            raise ValueError('Service changed during inspection')
        print(json.dumps({'read_only':True,'ok':True,**result},sort_keys=True))
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(diagnostic_failure(error),sort_keys=True),file=sys.stderr)
        sys.exit(1)
