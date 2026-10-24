import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('bounce',Path(__file__).with_name('inspect-bounce-codes-readonly.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture_spec=importlib.util.spec_from_file_location('recovery_tests',Path(__file__).with_name('test_first_host_recovery.py'))
f=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(f)
IDS=tuple('vps-'+str(i)*64 for i in range(1,5))
QUEUES={'ABCDE1','ABCDE2','ABCDE3','ABCDE4'}


def cohort():
    d,room,_,_=f.fixture();room.close();d.execute('ALTER TABLE delivery_events ADD COLUMN provider_event_at')
    for i in range(1,4):
        guest='guest'+str(i);email='fixture'+str(i)+'@example.com';ticket='ticket'+str(i);order='order'+str(i)
        d.execute("INSERT INTO attendee_notifications VALUES(?,?,'host_first_post','message')",(guest,m.SLUG))
        d.execute("INSERT INTO ticket_assignments VALUES(?,?,'active')",(guest,ticket))
        d.execute("INSERT INTO tickets VALUES(?,?,'issued',?)",(ticket,m.SLUG,order))
        d.execute("INSERT INTO orders VALUES(?,'paid','rsvp',?)",(order,email))
        d.execute("INSERT INTO attendee_profiles VALUES(?,'active',?,NULL)",(guest,email))
        d.execute("INSERT INTO event_registrations VALUES(?, ?,?,'confirmed','rsvp','proof',NULL,?)",(order,m.SLUG,guest,email))
    times=sorted(m.EXPECTED_EVENT_TIMES)
    for i,email in enumerate(['booking@example.com']+['fixture'+str(i)+'@example.com' for i in range(1,4)]):
        d.execute("INSERT INTO delivery_events(id,recipient,status,created_at,provider_id,provider_event_at) VALUES(?,?,'bounced','2026-10-18T16:00:00Z',?,?)",('bounce'+str(i),email,IDS[i],times[i]))
    d.commit();return d


def line(queue='ABCDE1',dsn='5.7.1',smtp='550',day='19'):
    return f'2026-10-{day}T16:00:01+00:00 host postfix/smtp[21]: {queue}: to=<private@example.com>, relay=private.remote[192.0.2.1]:25, dsn={dsn}, status=bounced (host private said: {smtp} hidden sensitive reason)\n'


class BounceCodes(unittest.TestCase):
    def test_exact_cohort_resolves_privately_without_writes(self):
        d=cohort();before=d.total_changes
        self.assertEqual(m.select_provider_ids(d),IDS)
        self.assertEqual(d.total_changes,before)
        d.close()

    def test_eligibility_and_cohort_drift_fail_closed(self):
        mutations=["DELETE FROM attendee_notifications WHERE attendee_id='guest'", "UPDATE orders SET status='refunded' WHERE id='order'", "UPDATE tickets SET status='voided' WHERE id='ticket'", "UPDATE ticket_assignments SET status='revoked' WHERE attendee_id='guest'", "UPDATE event_registrations SET normalized_email='different@example.com' WHERE attendee_id='guest'", "UPDATE event_registrations SET device_claimed_at=NULL WHERE attendee_id='guest'", "INSERT INTO push_subscriptions VALUES('guest',NULL,1)", "INSERT INTO marketing_contacts VALUES('booking@example.com',1)", "UPDATE room_host_first_posts SET cancelled_at='now'", "INSERT INTO room_suspensions VALUES('puro-exceso-20261024','guest',NULL)", "DELETE FROM staff_event_assignments", "INSERT INTO notification_preferences VALUES('puro-exceso-20261024','guest',0,NULL)", "INSERT INTO delivery_events(id,recipient,status) VALUES('complaint','booking@example.com','complained')", "INSERT INTO delivery_events(id,status) VALUES('room-first-email/message/guest','delivered')"]
        for sql in mutations:
            with self.subTest(sql=sql):
                d=cohort();d.execute(sql)
                with self.assertRaises(ValueError):m.select_provider_ids(d)
                d.close()

    def test_ambiguous_or_non_vps_history_is_not_broadened(self):
        for sql in ["UPDATE delivery_events SET provider_id='resend-receipt' WHERE id='bounce0'", "UPDATE delivery_events SET provider_event_at='2026-10-18T16:00:00Z' WHERE id='bounce0'", "INSERT INTO delivery_events SELECT 'duplicate',kind,recipient,status,attempt_count,payload_json,created_at,updated_at,provider_id,failure_reason,next_attempt_at,provider_event_at FROM delivery_events WHERE id='bounce0'"]:
            d=cohort();d.execute(sql)
            with self.assertRaises(ValueError):m.select_provider_ids(d)
            d.close()

    def test_pins_provider_event_time_not_creation_and_checks_all_four(self):
        d=cohort()
        d.execute("UPDATE delivery_events SET created_at='2020-01-01T00:00:00Z'")
        self.assertEqual(m.select_provider_ids(d),IDS)
        d.execute("UPDATE delivery_events SET provider_event_at=(SELECT provider_event_at FROM delivery_events WHERE id='bounce1') WHERE id='bounce0'")
        with self.assertRaises(ValueError):m.select_provider_ids(d)
        d.close()

    def test_updated_at_fallback_matches_private_endpoint(self):
        d=cohort();d.execute('UPDATE delivery_events SET updated_at=provider_event_at,provider_event_at=NULL')
        self.assertEqual(m.select_provider_ids(d),IDS);d.close()

    def test_exact_mail_lookup_selects_no_payload(self):
        d=sqlite3.connect(':memory:');d.execute('CREATE TABLE messages(id,queue_id,status,updated_at,payload)')
        for i,ident in enumerate(IDS):d.execute('INSERT INTO messages VALUES(?,?,?,?,?)',(ident,'ABCDE'+str(i+1),'bounced',1792425600,'private-token'))
        self.assertEqual(m.select_queue_ids(d,IDS),QUEUES)
        d.execute("UPDATE messages SET status='delivered' WHERE id=?",(IDS[0],))
        with self.assertRaises(ValueError):m.select_queue_ids(d,IDS)
        d.close()

    def test_numeric_only_and_scope(self):
        self.assertEqual(m.parse_line(line(),QUEUES),('ABCDE1','5.7.1','550'))
        self.assertIsNone(m.parse_line(line(queue='OTHER1'),QUEUES))
        self.assertIsNone(m.parse_line(line(day='20'),QUEUES))
        self.assertIsNone(m.parse_line(line().replace('2026-10-19T16:00:01+00:00','Oct 19 16:00:01'),QUEUES))
        self.assertIsNone(m.parse_line(line().replace('status=bounced','status=sent'),QUEUES))
        self.assertEqual(m.parse_line(line().replace('said: 550','size: 550'),QUEUES),('ABCDE1','5.7.1',None))
        self.assertIsNone(m.parse_line(line().replace('status=bounced','dsn=5.1.1, status=bounced'),QUEUES))

    def scan_fixture(self, content, second=None, cap=None):
        with tempfile.TemporaryDirectory() as tmp:
            paths=(Path(tmp)/'mail.log',Path(tmp)/'mail.log.1');paths[0].write_text(content)
            if second is not None:paths[1].write_text(second)
            with patch.object(m,'LOG_PATHS',paths),patch.object(m,'safe_file',side_effect=lambda p,*_:p.lstat()),patch.object(m,'MAX_BYTES',cap or m.MAX_BYTES):
                return m.scan_logs(QUEUES,{0})

    def test_aggregate_deduplicates_and_redacts_all_private_material(self):
        result=self.scan_fixture(line()+line('ABCDE2','5.1.1'),line())
        self.assertEqual(result['messages_with_numeric_evidence'],2)
        self.assertEqual(result['unknown_messages'],2)
        raw=json.dumps(result)
        for sentinel in ['private','remote','ABCDE','vps-','192.0.2.1','hidden']:self.assertNotIn(sentinel,raw)
        self.assertEqual({g['category'] for g in result['numeric_code_groups']},{'permanent_security_or_policy','permanent_address_status'})

    def test_missing_truncated_ambiguous_and_legacy_evidence_remain_unknown(self):
        result=self.scan_fixture(line(),cap=10)
        self.assertTrue(result['scan_incomplete']);self.assertEqual(result['unknown_messages'],4)
        result=self.scan_fixture(line()+line(dsn='5.1.1'))
        self.assertEqual(result['ambiguous_messages'],1);self.assertEqual(result['messages_with_numeric_evidence'],0)
        result=self.scan_fixture('Oct 19 16:00:01 '+line())
        self.assertEqual(result['unknown_messages'],4);self.assertEqual(result['missing_log_files'],1)

    def test_zero_write_connection_denies_mutations(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fixture.sqlite';d=sqlite3.connect(path);d.execute('CREATE TABLE x(id)');d.commit();d.close()
            with patch.object(m,'APP_DB',path),patch.object(m,'safe_file',side_effect=lambda p,*_:p.lstat()):
                with m.readonly_db(path,{0}) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM x').fetchone(),(0,))
                    for sql in ['INSERT INTO x VALUES(1)', 'PRAGMA query_only=OFF', "ATTACH DATABASE ':memory:' AS other",'CREATE TABLE y(id)']:
                        with self.assertRaises(sqlite3.DatabaseError):db.execute(sql)
                    self.assertEqual(db.total_changes,0)
            self.assertFalse(Path(str(path)+'-wal').exists());self.assertFalse(Path(str(path)+'-shm').exists())


class RunnableWrapper(unittest.TestCase):
    def exercise(self, changed_linkage=False, changed_service=False, log_failure=False):
        import contextlib,io
        ident=('container','revision',{'sendingEnabled':True},m.EXPECTED_SOURCE)
        linkage=(IDS,QUEUES,(('private-attendee','private@example.com','private-id'),),('private-queue',))
        second=(*linkage[:2],(('changed-member','private@example.com','private-id'),),linkage[3]) if changed_linkage else linkage
        with patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'open',return_value=123),patch.object(m.os,'close'), \
             patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()),patch.object(m.fcntl,'flock'), \
             patch.object(m,'app_identity'),patch.object(m.pwd,'getpwnam',return_value=type('P',(),{'pw_uid':456})()), \
             patch.object(m,'service_identity',side_effect=[ident,('changed',*ident[1:]) if changed_service else ident]), \
             patch.object(m,'private_linkage',side_effect=[linkage,second]), \
             patch.object(m,'scan_logs',return_value={'cohort_count':4,'unknown_messages':4},side_effect=ValueError('private log text') if log_failure else None), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            try:
                m.main()
                return json.loads(output.getvalue())
            except Exception as error:
                self.assertEqual(output.getvalue(),'')
                return m.metadata.safe_failure(error)

    def test_wrapper_outputs_no_private_linkage(self):
        result=self.exercise()
        self.assertTrue(result['ok']);self.assertNotIn('private',json.dumps(result))

    def test_member_service_or_log_change_withholds_results_and_redacts_errors(self):
        for opts,stage in [({'changed_linkage':True},'cohort_recheck'),({'changed_service':True},'stability_recheck'),({'log_failure':True},'bounded_logs')]:
            result=self.exercise(**opts)
            self.assertFalse(result['ok']);self.assertEqual(result['stage'],stage)
            self.assertNotIn('private',json.dumps(result));self.assertNotIn('cohort_count',result)

    def test_verified_service_pins_and_source_are_required(self):
        health={'service':'becore-tickets-mail','revision':m.EXPECTED_MAIL,'sendingEnabled':True}
        for revision,source,enabled in [(m.EXPECTED_MAIL,m.EXPECTED_SOURCE,True),('a'*40,m.EXPECTED_SOURCE,True),(m.EXPECTED_MAIL,'b'*64,True),(m.EXPECTED_MAIL,m.EXPECTED_SOURCE,False)]:
            with patch.object(m.metadata,'identity',return_value=('safe',)),patch.object(m.metadata,'marker',return_value=revision), \
                 patch.object(m.metadata,'health',return_value={**health,'sendingEnabled':enabled}),patch.object(m.metadata,'command',return_value='source'), \
                 patch.object(m.metadata,'source_evidence',return_value={'source_sha256':source}):
                if revision==m.EXPECTED_MAIL and source==m.EXPECTED_SOURCE and enabled:self.assertEqual(m.service_identity()[1],m.EXPECTED_MAIL)
                else:
                    with self.assertRaises(ValueError):m.service_identity()

    def test_validation_codes_never_export_dynamic_error_text(self):
        for message,code in m.VALIDATION_CODES.items():
            result=m.diagnostic_failure(ValueError(message))
            self.assertEqual(result['validation_code'],code)
        for error in [ValueError('private@example.com'),ValueError('secret-key'),RuntimeError('private payload')]:
            result=m.diagnostic_failure(error)
            self.assertNotIn('validation_code',result)
            self.assertNotIn('private',json.dumps(result));self.assertNotIn('secret',json.dumps(result))

    def test_pairing_evidence_preserves_private_member_and_queue_links(self):
        d=cohort();ids,evidence=m.select_provider_ids(d,with_evidence=True)
        self.assertEqual(ids,IDS);self.assertEqual(len(evidence),4);self.assertEqual(evidence[0][0],'guest')
        d.close()


if __name__=='__main__':unittest.main()
