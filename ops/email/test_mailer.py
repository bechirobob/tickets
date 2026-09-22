import concurrent.futures
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import smtplib
import threading
import urllib.request
import urllib.error
from mailer import Outbox, Rejected, SENDER, authenticated, message, signature, submit, validate, Server, handler


def payload(key='receipt/order-1'):
    return {'from': SENDER, 'to': 'guest@example.com', 'subject': 'Your night is booked', 'html': '<p>Your ticket</p>', 'text': 'Your ticket', 'idempotencyKey': key, 'kind': 'payment_confirmation'}


class MailTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.outbox = Outbox(Path(self.directory.name) / 'outbox.sqlite', enabled=lambda: True)

    def tearDown(self):
        self.directory.cleanup()

    def test_http_refuses_unsigned_and_tampered_mail_without_queuing(self):
        key = b'x' * 64
        server = Server(('127.0.0.1', 0), handler(self.outbox, key, 'fixture'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/v1/emails'
            body = json.dumps(payload()).encode()
            stamp = str(int(time.time()))
            for headers in [{}, {'x-tickets-timestamp': stamp, 'x-tickets-signature': signature(key, stamp, '/v1/emails', body + b' ')}]:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers))
                self.assertEqual(error.exception.code, 401)
            with self.outbox.db() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)
            headers = {'x-tickets-timestamp': stamp, 'x-tickets-signature': signature(key, stamp, '/v1/emails', body)}
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers)) as response:
                self.assertEqual(response.status, 200)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_signature_binds_body_endpoint_and_time(self):
        key, stamp, body = b'x' * 64, str(int(time.time())), b'{"ids":[]}'
        headers = {'x-tickets-timestamp': stamp, 'x-tickets-signature': signature(key, stamp, '/v1/status', body)}
        self.assertTrue(authenticated(key, headers, '/v1/status', body))
        self.assertFalse(authenticated(key, headers, '/v1/emails', body))
        self.assertFalse(authenticated(key, headers, '/v1/status', body + b' '))
        self.assertFalse(authenticated(key, headers, '/v1/status', body, now=int(stamp) + 301))

    def test_concurrent_retries_have_one_durable_message(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.outbox.enqueue(payload()), range(20)))
        self.assertEqual(len(set(row['id'] for row in results)), 1)
        with self.outbox.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 1)
        with self.assertRaises(Rejected) as error:
            self.outbox.enqueue({**payload(), 'to': 'different@example.com'})
        self.assertEqual(error.exception.status, 409)

    def test_paused_sending_and_shared_safety_allowance(self):
        self.outbox.enabled = lambda: False
        with self.assertRaises(Rejected) as error:
            self.outbox.enqueue(payload())
        self.assertEqual(error.exception.status, 503)
        self.outbox.enabled = lambda: True
        self.outbox.daily_limit = 1
        first = self.outbox.enqueue(payload())
        self.assertEqual(self.outbox.enqueue(payload())['id'], first['id'])
        with self.assertRaises(Rejected) as error:
            self.outbox.enqueue(payload('receipt/order-2'))
        self.assertEqual(error.exception.status, 429)

    def test_sender_recipient_header_injection_and_campaign_rejection(self):
        for change in [{'from': 'attacker@example.com'}, {'to': 'a@example.com,b@example.com'}, {'subject': 'Hello\r\nBcc: a@example.com'}, {'kind': 'event_announcement'}, {'idempotencyKey': ''}]:
            with self.assertRaises(Rejected):
                validate({**payload(), **change})
        mime = message('vps-' + 'a' * 64, payload())
        self.assertIn(b'From: BeCore Tickets <tickets@becoreops.com>', mime)
        self.assertIn(b'Reply-To: tickets@becoreops.com', mime)
        self.assertIn(b'multipart/alternative', mime)

    def test_crash_reconciliation_does_not_resend(self):
        ident = self.outbox.enqueue(payload())['id']
        with self.outbox.db() as db:
            db.execute("UPDATE messages SET status='submitting'")
        self.outbox.recover()
        self.assertFalse(self.outbox.drain_one(lambda *_: self.fail('Must not resend an uncertain handoff.')))
        self.outbox.reconcile_line(f'postfix/cleanup[2]: ABC123DEF: message-id=<{ident}@mail.becoreops.com>')
        self.outbox.reconcile_line('postfix/smtp[3]: ABC123DEF: to=<guest@example.com>, dsn=2.0.0, status=sent (250 OK)')
        self.assertEqual(self.outbox.statuses([ident])['messages'][0]['status'], 'delivered')
        self.outbox.reconcile_line('postfix/smtp[3]: ABC123DEF: status=deferred (temporary)')
        self.assertEqual(self.outbox.statuses([ident])['messages'][0]['status'], 'delivered')

    def test_permanent_missing_mailbox_suppresses_future_deliveries(self):
        ident = self.outbox.enqueue(payload())['id']
        self.outbox.drain_one(lambda *_: ('accepted', 'ABC123DEF', None))
        self.outbox.reconcile_line('postfix/smtp[3]: ABC123DEF: to=<guest@example.com>, dsn=5.1.1, status=bounced (550 user unknown)')
        self.assertEqual(self.outbox.statuses([ident])['messages'][0]['status'], 'bounced')
        with self.assertRaises(Rejected) as error:
            self.outbox.enqueue(payload('receipt/order-2'))
        self.assertEqual(error.exception.status, 422)

    def test_disconnect_after_data_is_ambiguous_and_not_automatically_retried(self):
        class Client:
            def __init__(self, *args, **kwargs): pass
            def ehlo(self): return 250, b'OK'
            def mail(self, address): return 250, b'OK'
            def rcpt(self, address): return 250, b'OK'
            def data(self, content): raise smtplib.SMTPServerDisconnected('response lost')
            def close(self): pass
        with patch('mailer.smtplib.SMTP', Client):
            self.assertEqual(submit('vps-' + 'a' * 64, payload())[0], 'review')

    def test_log_cursor_survives_restart_and_incomplete_lines(self):
        ident = self.outbox.enqueue(payload())['id']
        log = Path(self.directory.name) / 'mail.log'
        log.write_text(f'postfix/cleanup[2]: ABC123DEF: message-id=<{ident}@mail.becoreops.com>\npostfix/smtp[3]: ABC123DEF: status=sent')
        self.outbox.reconcile(log)
        self.assertEqual(self.outbox.statuses([ident])['messages'][0]['status'], 'sent')
        with log.open('a') as output: output.write(' (250 OK)\n')
        restored = Outbox(self.outbox.path, enabled=lambda: True)
        restored.reconcile(log)
        self.assertEqual(restored.statuses([ident])['messages'][0]['status'], 'delivered')


if __name__ == '__main__':
    unittest.main()
