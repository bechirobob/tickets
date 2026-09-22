"""Authenticated Tickets outbox. Postfix owns SMTP delivery and its durable queue."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import smtplib
import sqlite3
import threading
import time
from contextlib import contextmanager
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

SENDER = 'BeCore Tickets <tickets@becoreops.com>'
ADDRESS = 'tickets@becoreops.com'
HOST = 'mail.becoreops.com'
KINDS = {'team_invitation', 'organizer_report', 'organizer_invitation', 'organizer_signup', 'registration_access', 'registration_update', 'payment_confirmation', 'ticket_recovery', 'ticket_transfer', 'waitlist_offer', 'payment_recovery', 'support_update', 'operational_alert', 'connection_test'}
STATES = {'queued': 'sent', 'submitting': 'sent', 'accepted': 'sent', 'delayed': 'delayed', 'delivered': 'delivered', 'bounced': 'bounced', 'failed': 'failed', 'review': 'delayed'}


class Rejected(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def signature(key, timestamp, path, body):
    value = f'{timestamp}\nPOST\n{path}\n{hashlib.sha256(body).hexdigest()}'.encode()
    return hmac.new(key, value, hashlib.sha256).hexdigest()


def authenticated(key, headers, path, body, now=None):
    timestamp = headers.get('x-tickets-timestamp', '')
    supplied = headers.get('x-tickets-signature', '')
    return bool(re.fullmatch(r'\d{10}', timestamp) and abs((now or time.time()) - int(timestamp)) <= 300 and re.fullmatch(r'[a-f0-9]{64}', supplied) and hmac.compare_digest(signature(key, timestamp, path, body), supplied))


def validate(data):
    if not isinstance(data, dict) or set(data) != {'from', 'to', 'subject', 'html', 'text', 'idempotencyKey', 'kind'}:
        raise Rejected(400, 'Invalid message fields.')
    if not all(isinstance(value, str) for value in data.values()):
        raise Rejected(400, 'Message fields must be strings.')
    if data['from'] != SENDER or data['kind'] not in KINDS:
        raise Rejected(400, 'Only Tickets transactional messages are allowed.')
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}", data['to']) or len(data['to']) > 254:
        raise Rejected(400, 'One valid recipient is required.')
    if not 1 <= len(data['subject']) <= 200 or any(ord(c) < 32 or ord(c) == 127 for c in data['subject']):
        raise Rejected(400, 'Invalid subject.')
    if not 1 <= len(data['idempotencyKey']) <= 256 or not data['html'] or not data['text']:
        raise Rejected(400, 'Message content and a stable key are required.')
    if len(data['html'].encode()) + len(data['text'].encode()) > 220_000:
        raise Rejected(413, 'Message is too large.')
    return data


class Outbox:
    def __init__(self, path, enabled=lambda: False, daily_limit=2000):
        self.path, self.enabled, self.daily_limit = str(path), enabled, daily_limit
        with self.db() as db:
            db.executescript('''PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, payload TEXT,
                    status TEXT NOT NULL, queue_id TEXT, detail TEXT,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS message_queue ON messages(status,next_attempt);
                CREATE INDEX IF NOT EXISTS message_postfix ON messages(queue_id);
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS suppressions (email_hash TEXT PRIMARY KEY,created_at REAL NOT NULL);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def enqueue(self, data):
        validate(data)
        payload = json.dumps(data, sort_keys=True, separators=(',', ':'))
        digest = hashlib.sha256(payload.encode()).hexdigest()
        ident = 'vps-' + hashlib.sha256(data['idempotencyKey'].encode()).hexdigest()
        now = time.time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT payload_hash,status FROM messages WHERE id=?', (ident,)).fetchone()
            if existing:
                if existing['payload_hash'] != digest:
                    raise Rejected(409, 'That message key belongs to different content.')
                return {'id': ident, 'status': STATES[existing['status']], 'duplicate': True}
            if not self.enabled():
                raise Rejected(503, 'VPS email is awaiting delivery verification.')
            if db.execute('SELECT 1 FROM suppressions WHERE email_hash=?', (hashlib.sha256(data['to'].lower().encode()).hexdigest(),)).fetchone():
                raise Rejected(422, 'This recipient previously rejected delivery.')
            if db.execute('SELECT COUNT(*) FROM messages WHERE created_at>?', (now - 86400,)).fetchone()[0] >= self.daily_limit:
                raise Rejected(429, 'The server sending allowance is full; queued messages are safe.')
            db.execute('INSERT INTO messages(id,payload_hash,payload,status,created_at,updated_at) VALUES (?,?,?,\'queued\',?,?)', (ident, digest, payload, now, now))
        return {'id': ident, 'status': 'sent'}

    def statuses(self, ids):
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i, str) or not re.fullmatch(r'vps-[a-f0-9]{64}', i) for i in ids):
            raise Rejected(400, 'Invalid message IDs.')
        with self.db() as db:
            rows = db.execute('SELECT id,status,detail,updated_at FROM messages WHERE id IN (' + ','.join('?' for _ in ids) + ')', ids).fetchall()
        return {'messages': [{'id': row['id'], 'status': STATES[row['status']], 'detail': row['detail'], 'updatedAt': int(row['updated_at'] * 1000)} for row in rows]}

    def recover(self):
        # A crash around SMTP DATA must never cause an automatic duplicate.
        with self.db() as db:
            db.execute("UPDATE messages SET status='review',detail='Delivery handoff needs reconciliation.',updated_at=? WHERE status='submitting'", (time.time(),))

    def drain_one(self, transport=None):
        if not self.enabled():
            return False
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM messages WHERE status='queued' AND next_attempt<=? ORDER BY created_at LIMIT 1", (time.time(),)).fetchone()
            if row is None:
                return False
            db.execute("UPDATE messages SET status='submitting',attempts=attempts+1,updated_at=? WHERE id=?", (time.time(), row['id']))
        data = json.loads(row['payload'])
        if time.time() - row['created_at'] > 1800:
            state, queue_id, detail = 'failed', None, 'The message expired before handoff.'
        else:
            state, queue_id, detail = (transport or submit)(row['id'], data)
        with self.db() as db:
            # Log reconciliation may already have established delivery.
            db.execute("UPDATE messages SET status=?,queue_id=COALESCE(?,queue_id),detail=?,updated_at=?,next_attempt=? WHERE id=? AND status='submitting'", (state, queue_id, detail, time.time(), time.time() + min(300, 30 * (row['attempts'] + 1)), row['id']))
        return True

    def reconcile_line(self, line):
        match = re.search(r'\b([A-Z0-9]{5,}): message-id=<(vps-[a-f0-9]{64})@mail\.becoreops\.com>', line)
        with self.db() as db:
            if match:
                db.execute("UPDATE messages SET queue_id=?,status=CASE WHEN status IN ('queued','submitting','review') THEN 'accepted' ELSE status END,updated_at=? WHERE id=?", (match[1], time.time(), match[2]))
            delivered = re.search(r'\b([A-Z0-9]{5,}): .*\bstatus=(sent|deferred|bounced)\b', line)
            if delivered and 'postfix/smtp[' in line:
                status = {'sent': 'delivered', 'deferred': 'delayed', 'bounced': 'bounced'}[delivered[2]]
                row = db.execute('SELECT id,payload,status FROM messages WHERE queue_id=?', (delivered[1],)).fetchone()
                if row and row['status'] not in ('bounced', 'delivered'):
                    detail = {'sent': 'Accepted by the recipient mail server.', 'deferred': 'The recipient mail server requested a retry.', 'bounced': 'The recipient mail server rejected delivery.'}[delivered[2]]
                    db.execute('UPDATE messages SET status=?,detail=?,updated_at=? WHERE id=?', (status, detail, time.time(), row['id']))
                    if status == 'bounced' and row['payload'] and 'dsn=5.1.1' in line:
                        email = json.loads(row['payload'])['to'].lower()
                        db.execute('INSERT OR IGNORE INTO suppressions VALUES (?,?)', (hashlib.sha256(email.encode()).hexdigest(), time.time()))
            expired = re.search(r'\b([A-Z0-9]{5,}): .*status=expired\b', line)
            if expired and 'postfix/qmgr[' in line:
                db.execute("UPDATE messages SET status='failed',detail='The recipient server did not accept delivery before expiry.',updated_at=? WHERE queue_id=? AND status IN ('accepted','delayed','review')", (time.time(), expired[1]))

    def reconcile(self, path):
        if not path.is_file():
            return
        with self.db() as db:
            row = db.execute("SELECT value FROM metadata WHERE key='log_cursor'").fetchone()
        saved = json.loads(row[0]) if row else {}
        stat = path.stat()
        offset = saved.get('offset', 0) if saved.get('inode') == stat.st_ino and stat.st_size >= saved.get('offset', 0) else 0
        with path.open('rb') as log:
            log.seek(offset)
            for _ in range(5000):
                start = log.tell()
                line = log.readline()
                if not line or not line.endswith(b'\n'):
                    log.seek(start)
                    break
                self.reconcile_line(line.decode(errors='replace'))
            cursor = json.dumps({'inode': stat.st_ino, 'offset': log.tell()})
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO metadata VALUES ('log_cursor',?)", (cursor,))
            db.execute("UPDATE messages SET payload=NULL WHERE status IN ('delivered','bounced','failed') AND updated_at<?", (time.time() - 7 * 86400,))


def message(ident, data):
    mail = EmailMessage(policy=SMTP)
    mail['From'], mail['To'], mail['Subject'] = SENDER, data['to'], data['subject']
    mail['Date'], mail['Message-ID'] = formatdate(usegmt=True), f'<{ident}@{HOST}>'
    mail['Reply-To'] = ADDRESS
    mail.set_content(data['text'])
    mail.add_alternative(data['html'], subtype='html')
    return mail.as_bytes()


def submit(ident, data):
    client, data_started = None, False
    try:
        client = smtplib.SMTP('127.0.0.1', 25, timeout=10, local_hostname=HOST)
        client.ehlo()
        for method, value in [(client.mail, ADDRESS), (client.rcpt, data['to'])]:
            code, _ = method(value)
            if code >= 400:
                return ('queued' if code < 500 else 'failed'), None, f'Local mail handoff rejected (SMTP {code}).'
        data_started = True
        _, response = client.data(message(ident, data))
        match = re.search(rb'queued as ([A-Z0-9]+)', response)
        if not match:
            return 'review', None, 'Mail accepted; queue receipt requires reconciliation.'
        return 'accepted', match[1].decode(), None
    except smtplib.SMTPDataError as error:
        return ('queued' if error.smtp_code < 500 else 'failed'), None, f'Local mail handoff rejected (SMTP {error.smtp_code}).'
    except (OSError, smtplib.SMTPException):
        return ('review' if data_started else 'queued'), None, ('Delivery handoff needs reconciliation.' if data_started else 'Local mail service is temporarily unavailable.')
    finally:
        if client is not None:
            client.close()


def handler(outbox, key, revision):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log addresses, message bodies, signatures or access links.

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def reply(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Connection', 'close')
            if status in (429, 503):
                self.send_header('Retry-After', '60')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/healthz':
                return self.reply(200, {'service': 'becore-tickets-mail', 'revision': revision, 'sendingEnabled': outbox.enabled()})
            self.reply(404, {'error': 'Not found.'})

        def do_POST(self):
            try:
                if self.path not in ('/v1/emails', '/v1/status'):
                    raise Rejected(404, 'Not found.')
                if not re.fullmatch(r'\d{10}', self.headers.get('x-tickets-timestamp', '')) or not re.fullmatch(r'[a-f0-9]{64}', self.headers.get('x-tickets-signature', '')):
                    raise Rejected(401, 'Unauthorized.')
                length = self.headers.get('Content-Length', '')
                if not length.isdigit() or not 1 <= int(length) <= 262144 or self.headers.get('Transfer-Encoding'):
                    raise Rejected(413, 'Invalid request size.')
                body = self.rfile.read(int(length))
                if len(body) != int(length) or not authenticated(key, self.headers, self.path, body):
                    raise Rejected(401, 'Unauthorized.')
                data = json.loads(body)
                result = outbox.enqueue(data) if self.path == '/v1/emails' else outbox.statuses(data.get('ids') if isinstance(data, dict) else None)
                self.reply(200, result)
            except Rejected as error:
                self.reply(error.status, {'error': error.message, 'message': error.message})
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.reply(400, {'error': 'Invalid JSON.'})
            except Exception:
                self.reply(503, {'error': 'Mail service is temporarily unavailable.'})
    return Handler


class Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(24)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main():
    os.umask(0o077)
    key = Path('/run/tickets-api.key').read_bytes().strip()
    if len(key) < 32:
        raise RuntimeError('Mail signing key is missing.')
    outbox = Outbox('/data/outbox.sqlite', enabled=lambda: Path('/control/sending-enabled').is_file())
    outbox.recover()
    def work():
        while True:
            busy = False
            try:
                outbox.reconcile(Path('/mail-log/mail.log'))
                busy = outbox.drain_one()
            except Exception:
                print('Mail processing will retry; private message data omitted.', flush=True)
            time.sleep(0.05 if busy else 2)
    threading.Thread(target=work, daemon=True).start()
    Server(('0.0.0.0', 8826), handler(outbox, key, os.environ.get('RELEASE_SHA', 'unknown'))).serve_forever()


if __name__ == '__main__':
    main()
