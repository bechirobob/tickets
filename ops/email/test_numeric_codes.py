import concurrent.futures
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import importlib.util
import subprocess
import sys
# Exercise the exact installed predecessor, not a reimplementation of it.
_baseline_temp=tempfile.TemporaryDirectory()
_baseline_path=Path(_baseline_temp.name)/'baseline_mailer.py'
_baseline_source=subprocess.check_output(['git','--no-replace-objects','show','dc8355093f42cb00501d9f587e494b25811af884:ops/email/mailer.py'])
if hashlib.sha256(_baseline_source).hexdigest()!='fea4874c1877a4c227302c8030da6d4f6b2855450de27a7362f021d854e40c5b':
    raise RuntimeError('Historical mailer fixture differs.')
_baseline_path.write_bytes(_baseline_source)
_baseline_spec=importlib.util.spec_from_file_location('baseline_mailer',_baseline_path)
baseline_mailer=importlib.util.module_from_spec(_baseline_spec)
sys.modules['baseline_mailer']=baseline_mailer
_baseline_spec.loader.exec_module(baseline_mailer)
import mailer
from test_mailer import payload


def log(queue='QUEUE1',outcome='bounced',dsn='5.7.1',reply='host remote.example said: 550 private-address@example.com private response'):
    return f'Oct 24 15:00:00 host postfix/smtp[123]: {queue}: to=<private-address@example.com>, relay=remote.example[192.0.2.1]:25, dsn={dsn}, status={outcome} ({reply})\n'


class NumericCodes(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.path=Path(self.directory.name)/'outbox.sqlite'

    def tearDown(self):self.directory.cleanup()

    def queued(self,box,key='fixture/one',queue='QUEUE1'):
        ident=box.enqueue(payload(key))['id']
        with box.db() as db:db.execute("UPDATE messages SET status='accepted',queue_id=? WHERE id=?",(queue,ident))
        return ident

    def test_additive_migration_preserves_history_cursor_and_old_binary(self):
        old=baseline_mailer.Outbox(self.path,enabled=lambda:True)
        ident=self.queued(old)
        old.reconcile_line(log())
        with old.db() as db:
            db.execute("INSERT INTO metadata VALUES('log_cursor','{\"offset\":123,\"inode\":456}')")
            before=tuple(db.execute('SELECT * FROM messages').fetchone())
        new=mailer.Outbox(self.path,enabled=lambda:True)
        with new.db() as db:
            row=db.execute('SELECT * FROM messages').fetchone()
            self.assertEqual(tuple(row)[:-2],before)
            self.assertIsNone(row['dsn_code']);self.assertIsNone(row['smtp_code'])
            self.assertEqual(db.execute("SELECT value FROM metadata WHERE key='log_cursor'").fetchone()[0],'{"offset":123,"inode":456}')
            columns=list(db.execute('PRAGMA table_info(messages)'))
            self.assertTrue(all(r['type']=='TEXT' and not r['notnull'] and r['dflt_value'] is None for r in columns if r['name'] in ('dsn_code','smtp_code')))
        # Replayed terminal evidence does not fill previously unknown codes.
        new.reconcile_line(log())
        self.assertEqual(new.statuses([ident])['messages'][0]['detail'],mailer.DELIVERY_DETAILS['bounced'])
        # Real previous implementation can reopen the additive schema and send a
        # synthetic record through its injected transport, never SMTP.
        rollback=baseline_mailer.Outbox(self.path,enabled=lambda:True)
        second=rollback.enqueue(payload('fixture/two'))['id']
        self.assertTrue(rollback.drain_one(lambda *_:('accepted','QUEUE2',None)))
        self.assertEqual(rollback.statuses([second])['messages'][0]['status'],'sent')
        with rollback.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM messages').fetchone()[0],2)

    def test_terminal_unknowns_and_late_failed_outcomes_keep_baseline_behavior(self):
        old=baseline_mailer.Outbox(self.path,enabled=lambda:True)
        ids=[]
        for index,state in enumerate(['delivered','bounced','failed']):
            ident=self.queued(old,key='fixture/terminal/'+state,queue='QUEUE'+str(index+1));ids.append((ident,state))
            with old.db() as db:db.execute('UPDATE messages SET status=? WHERE id=?',(state,ident))
        new=mailer.Outbox(self.path,enabled=lambda:True)
        with new.db() as db:
            self.assertTrue(all(row[0] is None and row[1] is None for row in db.execute('SELECT dsn_code,smtp_code FROM messages')))
        for index,(ident,state) in enumerate(ids):
            new.reconcile_line(log(queue='QUEUE'+str(index+1)))
            with new.db() as db:
                expected=('bounced','5.7.1','550') if state=='failed' else (state,None,None)
                self.assertEqual(tuple(db.execute('SELECT status,dsn_code,smtp_code FROM messages WHERE id=?',(ident,)).fetchone()),expected)

    def test_repeated_and_concurrent_startup_is_idempotent(self):
        baseline_mailer.Outbox(self.path)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _:mailer.Outbox(self.path),range(8)))
        with sqlite3.connect(self.path) as db:
            names=[r[1] for r in db.execute('PRAGMA table_info(messages)')]
            self.assertEqual(names.count('dsn_code'),1);self.assertEqual(names.count('smtp_code'),1)

    def test_incompatible_second_column_rolls_back_partial_migration(self):
        baseline_mailer.Outbox(self.path)
        with sqlite3.connect(self.path) as db:db.execute('ALTER TABLE messages ADD COLUMN smtp_code INTEGER')
        with self.assertRaises(RuntimeError):mailer.Outbox(self.path)
        with sqlite3.connect(self.path) as db:self.assertNotIn('dsn_code',[r[1] for r in db.execute('PRAGMA table_info(messages)')])

    def test_malformed_nullable_and_case_colliding_columns_fail_closed(self):
        for definition in ['dsn_code INTEGER', 'dsn_code TEXT NOT NULL DEFAULT \'x\'',
                           'smtp_code TEXT NOT NULL DEFAULT \'x\'', 'DSN_CODE TEXT']:
            with self.subTest(definition=definition):
                path=Path(self.directory.name)/(str(abs(hash(definition)))+'.sqlite')
                baseline_mailer.Outbox(path)
                with sqlite3.connect(path) as db:db.execute('ALTER TABLE messages ADD COLUMN '+definition)
                with self.assertRaises((RuntimeError,sqlite3.OperationalError)):mailer.Outbox(path)
                with sqlite3.connect(path) as db:
                    names=[r[1] for r in db.execute('PRAGMA table_info(messages)')]
                    if definition.startswith('smtp_code'):self.assertNotIn('dsn_code',names)

    def test_real_payload_expiry_keeps_existing_code_row_retention(self):
        import time
        box=mailer.Outbox(self.path,enabled=lambda:True)
        ident=self.queued(box);box.reconcile_line(log())
        with box.db() as db:db.execute('UPDATE messages SET updated_at=? WHERE id=?',(time.time()-8*86400,ident))
        empty=Path(self.directory.name)/'mail.log';empty.write_text('')
        box.reconcile(empty)
        with box.db() as db:
            row=db.execute('SELECT payload,detail,dsn_code,smtp_code FROM messages WHERE id=?',(ident,)).fetchone()
            self.assertEqual(tuple(row),(None,mailer.DELIVERY_DETAILS['bounced'],'5.7.1','550'))

    def test_only_room_kind_is_added_and_html_is_unchanged(self):
        box=mailer.Outbox(self.path,enabled=lambda:True)
        message={**payload(),'kind':'room_host_post'}
        ident=box.enqueue(message)['id']
        with box.db() as db:self.assertEqual(json.loads(db.execute('SELECT payload FROM messages WHERE id=?',(ident,)).fetchone()[0]),message)
        with self.assertRaises(mailer.Rejected):box.enqueue({**message,'kind':'event_host_pass'})
        self.assertEqual(mailer.KINDS-baseline_mailer.KINDS,{'room_host_post'})

    def test_matched_queue_stores_only_numeric_codes_and_generic_status_detail(self):
        box=mailer.Outbox(self.path,enabled=lambda:True);ident=self.queued(box)
        box.reconcile_line(log())
        result=box.statuses([ident])['messages'][0]
        self.assertEqual(result['detail'],'The recipient mail server rejected delivery. (DSN 5.7.1; SMTP 550)')
        with box.db() as db:
            row=db.execute('SELECT detail,dsn_code,smtp_code FROM messages WHERE id=?',(ident,)).fetchone()
            self.assertEqual(tuple(row),(mailer.DELIVERY_DETAILS['bounced'],'5.7.1','550'))
        for value in ('private-address','remote.example','192.0.2.1','private response'):self.assertNotIn(value,json.dumps(result))

    def test_unknown_or_ambiguous_queue_does_not_modify_messages(self):
        box=mailer.Outbox(self.path,enabled=lambda:True);one=self.queued(box)
        with box.db() as db:before=tuple(db.execute('SELECT * FROM messages').fetchone())
        box.reconcile_line(log(queue='OTHER1'))
        with box.db() as db:self.assertEqual(tuple(db.execute('SELECT * FROM messages').fetchone()),before)
        two=self.queued(box,key='fixture/two')
        box.reconcile_line(log())
        with box.db() as db:self.assertEqual({r[0] for r in db.execute('SELECT status FROM messages')},{'accepted'})

    def test_invalid_duplicate_injected_codes_stay_unknown(self):
        for text in [log(dsn='5.7.1evil',reply='host said: 550evil secret'),
                     log(dsn='5.7.1, dsn=5.1.1',reply='host said: 550 first said: 551 second'),
                     log(dsn='4.7.1',reply='host said: 450 mismatch'),
                     log(dsn='invalid',reply='dsn=5.7.1 status=bounced 550 secret')]:
            self.assertEqual(mailer.postfix_delivery(text)[2:],(None,None))
        for text in [log().replace('postfix/smtp','postfix/qmgr'),log()+'extra\n',log()+('x'*16384)]:
            self.assertIsNone(mailer.postfix_delivery(text))

    def test_smtp_looking_numbers_without_said_are_not_codes(self):
        for reply in ['550 mailbox response', 'size=550 address 550@example.com',
                      'host [192.0.2.550]:25 response 550', 'SMTP 550', 'said: 5500 invalid']:
            self.assertIsNone(mailer.postfix_delivery(log(reply=reply))[3])
        self.assertEqual(mailer.postfix_delivery(log(reply='host said: 550 rejected'))[3], '550')

    def test_delayed_codes_replaced_by_new_evidence_and_expiry_clears_them(self):
        box=mailer.Outbox(self.path,enabled=lambda:True);ident=self.queued(box)
        box.reconcile_line(log(outcome='deferred',dsn='4.7.1',reply='host said: 450 retry'))
        self.assertIn('DSN 4.7.1',box.statuses([ident])['messages'][0]['detail'])
        box.reconcile_line(log(outcome='sent',dsn='2.0.0',reply='250 accepted'))
        self.assertEqual(box.statuses([ident])['messages'][0]['detail'],'Accepted by the recipient mail server. (DSN 2.0.0)')
        other=self.queued(box,key='fixture/expiry',queue='QUEUE2')
        box.reconcile_line(log(queue='QUEUE2',outcome='deferred',dsn='4.7.1',reply='host said: 450 retry'))
        box.reconcile_line('postfix/qmgr[123]: QUEUE2: status=expired')
        with box.db() as db:self.assertEqual(tuple(db.execute('SELECT dsn_code,smtp_code FROM messages WHERE id=?',(other,)).fetchone()),(None,None))

    def test_status_validates_codes_again_and_never_exports_raw_column_text(self):
        box=mailer.Outbox(self.path,enabled=lambda:True);ident=self.queued(box)
        box.reconcile_line(log())
        for dsn,smtp in [('5.7.1 private','550 private'),('4.7.1','450')]:
            with box.db() as db:db.execute('UPDATE messages SET dsn_code=?,smtp_code=? WHERE id=?',(dsn,smtp,ident))
            self.assertEqual(box.statuses([ident])['messages'][0]['detail'],mailer.DELIVERY_DETAILS['bounced'])

    def test_existing_suppression_uses_exact_valid_dsn(self):
        box=mailer.Outbox(self.path,enabled=lambda:True);self.queued(box)
        box.reconcile_line(log(dsn='5.1.1'))
        with box.db() as db:
            self.assertEqual(db.execute('SELECT email_hash FROM suppressions').fetchone()[0],hashlib.sha256(payload()['to'].encode()).hexdigest())

    def test_signed_room_http_receipt_to_numeric_status_without_smtp(self):
        import threading,time,urllib.request
        box=mailer.Outbox(self.path,enabled=lambda:True);key=b'synthetic-signing-key-not-production'*2
        server=mailer.Server(('127.0.0.1',0),mailer.handler(box,key,'synthetic'))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def signed(path,value):
            body=json.dumps(value).encode();stamp=str(int(time.time()))
            request=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,data=body,
                headers={'Content-Type':'application/json','x-tickets-timestamp':stamp,
                         'x-tickets-signature':mailer.signature(key,stamp,path,body)})
            with urllib.request.urlopen(request,timeout=3) as response:
                self.assertEqual(response.status,200);return json.load(response)
        try:
            receipt=signed('/v1/emails',{**payload('fixture/room-http'),'kind':'room_host_post'})
            self.assertRegex(receipt['id'],r'^vps-[a-f0-9]{64}$')
            self.assertTrue(box.drain_one(lambda *_:('accepted','HTTPQ1',None)))
            box.reconcile_line(log(queue='HTTPQ1'))
            status=signed('/v1/status',{'ids':[receipt['id']]})['messages'][0]
            self.assertEqual(status['status'],'bounced')
            self.assertEqual(status['detail'],'The recipient mail server rejected delivery. (DSN 5.7.1; SMTP 550)')
            self.assertNotIn('private',json.dumps(status))
            replay=signed('/v1/emails',{**payload('fixture/room-http'),'kind':'room_host_post'})
            self.assertTrue(replay['duplicate']);self.assertEqual(replay['id'],receipt['id'])
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_retention_statement_unchanged(self):
        original=Path(baseline_mailer.__file__).read_text();updated=Path(mailer.__file__).read_text()
        statement="UPDATE messages SET payload=NULL WHERE status IN ('delivered','bounced','failed') AND updated_at<?"
        self.assertEqual(updated.count(statement),1);self.assertIn(statement,original)
        self.assertIn('(time.time() - 7 * 86400,)',updated)


if __name__=='__main__':unittest.main()
