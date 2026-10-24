import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import importlib.util
import sys
BASE=Path(__file__).resolve().parent
for name,filename in [('metadata','inspect-mail-service-readonly.py'),('upgrade','upgrade-room-mail.py')]:
    spec=importlib.util.spec_from_file_location(name,BASE/filename)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    spec.loader.exec_module(module)
u=sys.modules['upgrade']

REV='a'*40
SOURCE=(BASE.parent/'email/mailer.py').read_bytes()


def config():
    value={**u.EXPECTED,'image':u.OLD_IMAGE,'running':True,'id':'b'*64,'hostname':'b'*12,'networks':'bridge;','env':'path;frontend;release;','labels':0}
    value['mounts']=[{'Type':kind,'Name':src if kind=='volume' else '', 'Source':src,'Destination':dest,'RW':rw,'Propagation':'rprivate' if kind=='bind' else ''} for dest,(kind,src,rw) in u.MOUNTS.items()]
    return value


class OperatorTests(unittest.TestCase):
    def test_exact_projection_rejects_more_access_and_unexpected_environment(self):
        with patch.object(u,'command',return_value=json.dumps(config()).encode()):self.assertEqual(u.inspect_config(u.NAME,u.OLD_REV,u.OLD_IMAGE),'b'*64)
        for field,value in [('privileged',True),('cap_add',['SYS_ADMIN']),('env','path;frontend;release;unexpected;'),('networks','bridge;host;'),('labels',1),('sysctls',{'danger':'on'}),('image','sha256:'+'c'*64)]:
            data=config();data[field]=value
            with self.subTest(field=field),patch.object(u,'command',return_value=json.dumps(data).encode()),self.assertRaises(ValueError):u.inspect_config(u.NAME,u.OLD_REV,u.OLD_IMAGE)
        data=config();data['mounts'][0]['RW']=True
        with patch.object(u,'command',return_value=json.dumps(data).encode()),self.assertRaises(ValueError):u.inspect_config(u.NAME,u.OLD_REV,u.OLD_IMAGE)

    def test_offline_build_changes_only_reviewed_file(self):
        operation=u.Upgrade(REV,SOURCE)
        def command(args,data=None,**kwargs):
            self.assertEqual(args[:5],['docker','build','--quiet','--pull=false','--network=none'])
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                self.assertEqual(archive.getnames(),['Dockerfile','mailer.py'])
                self.assertEqual(archive.extractfile('mailer.py').read(),SOURCE)
                dockerfile=archive.extractfile('Dockerfile').read().decode()
                self.assertEqual(dockerfile,'FROM '+u.OLD_IMAGE+'\nCOPY --chown=0:0 mailer.py /app/mailer.py\n')
            return ('sha256:'+'c'*64).encode()
        with patch.object(u,'command',side_effect=command):operation.build()
        self.assertEqual(operation.image,'sha256:'+'c'*64)
        with self.assertRaises(ValueError):u.Upgrade(REV,SOURCE+b'\n')

    def test_real_fence_blocks_all_handoff_states_and_nonempty_spool(self):
        operation=u.Upgrade(REV,SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'outbox.sqlite';db=sqlite3.connect(path);db.execute('CREATE TABLE messages(status)');db.commit();db.close()
            with patch.object(u,'MAIL_UID',u.os.geteuid()),patch.object(u,'DB',path),patch.object(u,'safe_stat'),patch.object(u,'command',return_value=b''):
                with operation.fence(u.NAME) as db:
                    other=sqlite3.connect(path,timeout=0)
                    with self.assertRaises(sqlite3.OperationalError):other.execute("INSERT INTO messages VALUES('queued')")
                    other.close();self.assertEqual(db.total_changes,0)
                for state in ['submitting','accepted','delayed','review']:
                    db=sqlite3.connect(path);db.execute('DELETE FROM messages');db.execute('INSERT INTO messages VALUES(?)',(state,));db.commit();db.close()
                    with self.assertRaises(ValueError):
                        with operation.fence(u.NAME):self.fail('Unsafe fence passed')
                db=sqlite3.connect(path);db.execute('DELETE FROM messages');db.commit();db.close()
                with patch.object(u,'command',return_value=b'{"recipients":["private@example.com"]}'):
                    with self.assertRaises(ValueError):
                        with operation.fence(u.NAME):self.fail('Nonempty spool passed')

    def test_pause_preserves_exact_marker_and_journals_enable_boundary_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);control=root/'control';control.mkdir();flag=control/'sending-enabled';flag.write_bytes(b'original marker');flag.chmod(0o600)
            with patch.object(u,'ROOT',root),patch.object(u,'FLAG',flag):
                operation=u.Upgrade(REV,SOURCE);operation.marker_identity=u.safe_stat(flag,flag.stat().st_uid)
                phases=[]
                def record(phase):
                    if phase=='enable_boundary':self.assertFalse(flag.exists());self.assertTrue(operation.paused.exists())
                    phases.append(phase)
                with patch.object(operation,'record',side_effect=record),patch.object(u,'safe_stat',side_effect=lambda p,*args:(p.stat().st_dev,p.stat().st_ino,p.stat().st_uid,p.stat().st_gid,p.stat().st_mode&0o777,p.stat().st_size)):
                    operation.pause();self.assertFalse(flag.exists());self.assertEqual(operation.paused.read_bytes(),b'original marker')
                    operation.enable(REV)
                self.assertEqual(phases,['pause_boundary','enable_boundary','enabled']);self.assertEqual(flag.read_bytes(),b'original marker')
                self.assertEqual(flag.stat().st_mode&0o777,0o600)

    def test_rollback_handoff_blocks_stop_and_preserves_sender(self):
        operation=u.Upgrade(REV,SOURCE);operation.old_stopped=True;operation.stop_confirmed=True
        @contextlib.contextmanager
        def busy(*_):raise ValueError('Handoff');yield
        with patch.object(operation,'fence',side_effect=busy),patch.object(u,'inspect_config'),patch.object(u,'command') as command,patch.object(operation,'pause') as pause:
            with self.assertRaises(ValueError):operation.rollback()
            command.assert_not_called();pause.assert_not_called()

    def test_quiescent_rollback_keeps_fence_until_stopped_never_restores_db(self):
        operation=u.Upgrade(REV,SOURCE);operation.old_stopped=True;operation.stop_confirmed=True;operation.image='sha256:'+'c'*64
        events=[]
        @contextlib.contextmanager
        def fence(*_):events.append('fence_open');yield;events.append('fence_close')
        def command(args,*_,**__):
            events.append(' '.join(args))
            if args[:2]==['docker','stop']:self.assertNotIn('fence_close',events)
            if args[:2]==['docker','start']:self.assertIn('fence_close',events)
            return b''
        with patch.object(operation,'fence',side_effect=fence),patch.object(operation,'pause'),patch.object(operation,'record'),patch.object(operation,'enable'), \
             patch.object(u,'inspect_config'),patch.object(u,'wait_ready'),patch.object(u,'check_source_health'),patch.object(u,'command',side_effect=command):operation.rollback()
        self.assertTrue(any('rollback-' in event for event in events));self.assertFalse(any(' rm ' in event or 'sqlite' in event for event in events))

    def test_uncertain_old_stop_does_not_enable_a_stopped_or_unknown_sender(self):
        operation=u.Upgrade(REV,SOURCE);operation.stop_attempted=True
        with patch.object(u,'inspect_config',side_effect=ValueError('not running')),patch.object(operation,'enable') as enable:
            with self.assertRaises(ValueError):operation.rollback()
            enable.assert_not_called()

    def test_schema_verification_does_not_mutate_rows(self):
        operation=u.Upgrade(REV,SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'db';db=sqlite3.connect(path);db.execute('CREATE TABLE messages(id,dsn_code TEXT,smtp_code TEXT)');db.execute("INSERT INTO messages VALUES('fixture',NULL,NULL)");db.commit();db.close()
            before=path.read_bytes()
            with patch.object(u,'MAIL_UID',u.os.geteuid()),patch.object(u,'DB',path),patch.object(u,'safe_stat'):operation.verify_schema()
            self.assertEqual(path.read_bytes(),before)

    def test_secrets_are_not_in_failure_output(self):
        import subprocess
        failure=u.metadata.safe_failure(subprocess.CalledProcessError(1,['private key'],stderr='secret'))
        self.assertNotIn('private',json.dumps(failure));self.assertNotIn('secret',json.dumps(failure))
        self.assertNotIn('{{json .Config.Env}}',u.ENV_TEMPLATE);self.assertIn('{{else}}unexpected;',u.ENV_TEMPLATE)



class FullSequence(unittest.TestCase):
    def exercise(self, failure=None, interrupted=False):
        from types import SimpleNamespace
        events=[];held=[False];fences=[0]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'control').mkdir();state=root/'state';state.mkdir()
            original_lstat=Path.lstat
            def lstat(path):
                if path in (root,root/'control',state):return SimpleNamespace(st_mode=0o40700,st_uid=10000 if path==state else 0)
                return original_lstat(path)
            with patch.object(u,'ROOT',root),patch.object(u,'FLAG',root/'control/sending-enabled'),patch.object(u,'DB',state/'outbox.sqlite'):
                operation=u.Upgrade(REV,SOURCE)
                if interrupted:operation.journal.write_text('{"phase":"enable_boundary"}')
                @contextlib.contextmanager
                def fence(*_):
                    fences[0]+=1
                    if failure=='post_enable_busy' and fences[0]>1:raise ValueError('busy')
                    held[0]=True;events.append('fence_open')
                    try:yield
                    finally:events.append('fence_close');held[0]=False
                def command(args,*_,**__):
                    if args[:2]==['docker','ps']:return b''
                    events.append(tuple(args))
                    if args[:2]==['docker','stop']:
                        self.assertTrue(held[0])
                        if failure=='stop_uncertain':raise TimeoutError('private')
                    if args[:2]==['docker','start']:self.assertFalse(held[0])
                    return b''
                def start():
                    self.assertFalse(held[0]);events.append('start_replacement');operation.replacement=True
                    if failure=='start_uncertain':operation.start_uncertain=True;raise TimeoutError('private')
                def check(revision,source,enabled):
                    if revision==REV and enabled and failure=='post_enable_busy':raise ValueError('health failed')
                def ready(revision,*_):
                    events.append('ready_'+revision)
                    if revision==REV and failure=='paused_health':raise ValueError('private')
                def enable(revision):events.append('enable_'+revision)
                with contextlib.ExitStack() as stack:
                    for manager in [patch.object(Path,'lstat',lstat),patch.object(u.os,'geteuid',return_value=0),patch.object(u.os,'open',return_value=77),
                     patch.object(u.os,'fstat',return_value=SimpleNamespace(st_mode=0o100600,st_uid=0)),patch.object(u.os,'close'),patch.object(u.fcntl,'flock'),
                     patch.object(u,'image_check'),patch.object(u,'private_ancestry'),patch.object(u,'app_check'),patch.object(u,'provider_check',return_value={'provider':'vps','signing_key_valid':True}),
                     patch.object(u,'inspect_config'),patch.object(u,'check_source_health',side_effect=check),patch.object(u,'wait_ready',side_effect=ready),
                     patch.object(u.metadata,'marker',return_value=u.OLD_REV),patch.object(u,'safe_stat',return_value=('marker',)),
                     patch.object(operation,'record',side_effect=lambda phase:events.append(phase)),
                     patch.object(operation,'fence',side_effect=fence),patch.object(operation,'pause',side_effect=lambda:events.append('pause')),
                     patch.object(operation,'start',side_effect=start),patch.object(operation,'enable',side_effect=enable),
                     patch.object(operation,'verify_schema',side_effect=lambda:events.append('schema_verified')),patch.object(u,'command',side_effect=command)]:
                        stack.enter_context(manager)
                    build=stack.enter_context(patch.object(operation,'build',side_effect=lambda:setattr(operation,'image','sha256:'+'c'*64)))
                    if failure or interrupted:
                        with self.assertRaises((ValueError,RuntimeError,TimeoutError)):operation.run()
                    else:operation.run()
                    if interrupted:build.assert_not_called()
                return events

    def test_full_success_preserves_stop_fence_pause_and_enable_order(self):
        events=self.exercise()
        stop=next(i for i,x in enumerate(events) if isinstance(x,tuple) and x[:2]==('docker','stop'))
        self.assertLess(events.index('pause'),stop)
        self.assertLess(stop,events.index('fence_close'))
        self.assertLess(events.index('fence_close'),events.index('start_replacement'))
        self.assertLess(events.index('schema_verified'),events.index('enable_'+REV))
        self.assertEqual(events[-1],'verified')
        self.assertFalse(any(isinstance(x,tuple) and x[:2]==('docker','rm') for x in events))

    def test_paused_health_failure_rolls_back_only_under_second_fence(self):
        events=self.exercise('paused_health')
        self.assertEqual(events.count('fence_open'),2)
        self.assertNotIn('enable_'+REV,events);self.assertIn('enable_'+u.OLD_REV,events)
        self.assertIn('rolled_back',events)

    def test_post_enable_handoff_leaves_current_sender_running(self):
        events=self.exercise('post_enable_busy')
        stops=[x for x in events if isinstance(x,tuple) and x[:2]==('docker','stop')]
        self.assertEqual(len(stops),1)
        self.assertIn('enable_'+REV,events);self.assertNotIn('enable_'+u.OLD_REV,events)
        self.assertEqual(events[-1],'manual_reconciliation_required')

    def test_uncertain_stop_or_start_never_repeated_or_enables(self):
        for failure in ['stop_uncertain','start_uncertain']:
            events=self.exercise(failure)
            self.assertEqual(sum(isinstance(x,tuple) and x[:2]==('docker','stop') for x in events),1)
            self.assertFalse(any(isinstance(x,str) and x.startswith('enable_') for x in events))
            self.assertEqual(events[-1],'manual_reconciliation_required')

    def test_existing_journal_blocks_all_work(self):
        self.assertEqual(self.exercise(interrupted=True),[])


class PreflightAndProvider(unittest.TestCase):
    def test_provider_probe_exports_only_enum_and_boolean(self):
        from types import SimpleNamespace
        for provider,key,expected in [('vps','private-secret-value-of-at-least-32-characters',True),('resend','short',False),('sensitive-unexpected','short',False)]:
            raw=json.dumps({'TRANSACTIONAL_EMAIL_PROVIDER':provider,'VPS_EMAIL_SIGNING_KEY':key,'OTHER':'secret'}).encode()
            with patch.object(u.metadata,'command',return_value='123'),patch.object(Path,'read_bytes',return_value=b'TICKETS_CONFIG=/run/becore-tickets-runtime/runtime.json\0'), \
                 patch.object(u.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=456)),patch.object(u,'safe_stat'), \
                 patch.object(u,'read_private',side_effect=[raw,raw]):
                if expected:self.assertEqual(u.provider_check(),{'provider':'vps','signing_key_valid':True})
                else:
                    with self.assertRaises(u.RouteBlocked) as caught:u.provider_check()
                    self.assertNotIn(key,str(caught.exception));self.assertIn(caught.exception.provider,['resend','unknown'])

    def test_preflight_is_aggregate_read_only_and_does_not_build_or_pause(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);dbpath=root/'db';db=sqlite3.connect(dbpath);db.execute('CREATE TABLE messages(status)');db.execute("INSERT INTO messages VALUES('review')");db.commit();db.close();before=dbpath.read_bytes()
            with patch.object(u,'ROOT',root),patch.object(u,'FLAG',root/'sending-enabled'),patch.object(u,'DB',dbpath):
                operation=u.Upgrade(REV,SOURCE)
                with patch.object(u.os,'geteuid',return_value=0),patch.object(u,'image_check'),patch.object(u,'private_ancestry'),patch.object(u,'app_check'),patch.object(u,'provider_check',return_value={'provider':'vps','signing_key_valid':True}), \
                     patch.object(u,'inspect_config'),patch.object(u,'check_source_health'),patch.object(u.metadata,'marker',return_value=u.OLD_REV),patch.object(u,'safe_stat'),patch.object(u,'mail_identity',side_effect=contextlib.nullcontext), \
                     patch.object(u,'command',return_value=b'{"recipients":["private@example.com"]}\n') as command,patch.object(operation,'check_paths'),patch.object(operation,'build') as build,patch.object(operation,'pause') as pause:
                    result=operation.preflight()
                    self.assertEqual(result['inflight_count'],1);self.assertEqual(result['spool_count'],1);self.assertFalse(result['quiescent_snapshot'])
                    self.assertNotIn('private',json.dumps(result));build.assert_not_called();pause.assert_not_called()
                    self.assertEqual(command.call_args.args[0],['docker','exec',u.NAME,'postqueue','-j'])
                self.assertEqual(dbpath.read_bytes(),before)

class OwnershipAndErrors(unittest.TestCase):
    def test_missing_wal_sidecars_created_by_configured_mail_uid(self):
        # Actual filesystem test uses this unprivileged test account as the
        # configured service UID; privilege switch sequencing is tested below.
        operation=u.Upgrade(REV,SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'outbox.sqlite';db=sqlite3.connect(path);db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE messages(status)');db.commit();db.close()
            self.assertFalse(Path(str(path)+'-wal').exists());self.assertFalse(Path(str(path)+'-shm').exists())
            with patch.object(u,'DB',path),patch.object(u,'MAIL_UID',u.os.geteuid()),patch.object(u,'command',return_value=b''):
                with operation.fence(u.NAME):
                    self.assertEqual(Path(str(path)+'-wal').stat().st_uid,u.MAIL_UID)
                    self.assertEqual(Path(str(path)+'-shm').stat().st_uid,u.MAIL_UID)

    def test_root_identity_is_restored_after_database_error(self):
        calls=[]
        with patch.object(u.os,'geteuid',return_value=0),patch.object(u.os,'getegid',return_value=0),patch.object(u.os,'getgroups',return_value=[0]), \
             patch.object(u.os,'setgroups',side_effect=lambda value:calls.append(('groups',value))),patch.object(u.os,'setegid',side_effect=lambda value:calls.append(('gid',value))),patch.object(u.os,'seteuid',side_effect=lambda value:calls.append(('uid',value))):
            with self.assertRaises(ValueError):
                with u.mail_identity():
                    self.assertEqual(calls[-1],('uid',10000));raise ValueError('synthetic failure')
        self.assertEqual(calls,[('groups',[]),('gid',10000),('uid',10000),('uid',0),('gid',0),('groups',[0])])

    def test_mutating_failure_has_truthful_mode_and_fixed_check_not_private_value(self):
        data=config();data['entrypoint']=['private-secret-entrypoint']
        with patch.object(u,'command',return_value=json.dumps(data).encode()):
            with self.assertRaises(u.CheckFailed) as caught:u.inspect_config(u.NAME,u.OLD_REV,u.OLD_IMAGE)
        with patch.object(u,'STAGE','manual_reconciliation_required'),patch.object(u,'FAILED_STAGE','enable'):
            result=u.failure_report(caught.exception,False)
        self.assertFalse(result['read_only']);self.assertTrue(result['uncertain_outcome'])
        self.assertEqual(result['check'],'config_entrypoint');self.assertEqual(result['failed_stage'],'enable')
        self.assertNotIn('private',json.dumps(result))
        self.assertTrue(u.failure_report(ValueError('secret'),True)['read_only'])

    def test_private_file_reader_rejects_replaced_path_and_validates_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'config';path.write_bytes(b'{"provider":"vps"}');path.chmod(0o600)
            with patch.object(u,'private_ancestry'):self.assertEqual(u.read_private(path,path.stat().st_uid),path.read_bytes())
            original=u.safe_stat(path,path.stat().st_uid)
            with patch.object(u,'private_ancestry'),patch.object(u,'safe_stat',side_effect=[original,(*original[:1],original[1]+1,*original[2:])]),self.assertRaises(ValueError):u.read_private(path,path.stat().st_uid)



class ReadinessAndPreflightGates(unittest.TestCase):
    def test_readiness_retries_only_unavailable_health(self):
        import urllib.error
        health={'service':u.NAME,'revision':REV,'sendingEnabled':False}
        source={'source_sha256':u.NEW_SOURCE,'room_host_post_supported':True,'event_host_pass_supported':False}
        with patch.object(u.metadata,'health',side_effect=[urllib.error.URLError('private'),health]) as probe,patch.object(u.time,'sleep'), \
             patch.object(u,'command',return_value=b'synthetic'),patch.object(u.metadata,'source_evidence',return_value=source):
            u.wait_ready(REV,u.NEW_SOURCE,False)
            self.assertEqual(probe.call_count,2)
            self.assertTrue(all(0<call.kwargs['timeout']<=5 for call in probe.call_args_list))

    def test_confirmed_source_mismatch_fails_once_without_retry(self):
        health={'service':u.NAME,'revision':REV,'sendingEnabled':False}
        with patch.object(u.metadata,'health',return_value=health) as probe,patch.object(u,'command',return_value=b'source') as command, \
             patch.object(u.metadata,'source_evidence',return_value={'source_sha256':'unexpected'}),patch.object(u.time,'sleep') as sleep:
            with self.assertRaises(u.CheckFailed) as caught:u.wait_ready(REV,u.NEW_SOURCE,False)
            self.assertEqual(caught.exception.check,'source_hash');self.assertEqual(probe.call_count,1);self.assertEqual(command.call_count,1);sleep.assert_not_called()

    def test_readiness_deadline_limits_repeated_timeouts(self):
        clock=[0.0];calls=[]
        def health(timeout):calls.append(timeout);clock[0]+=timeout;raise TimeoutError('private')
        with patch.object(u.time,'monotonic',side_effect=lambda:clock[0]),patch.object(u.time,'sleep',side_effect=lambda n:clock.__setitem__(0,clock[0]+n)), \
             patch.object(u.metadata,'health',side_effect=health),patch.object(u,'command') as command:
            with self.assertRaises(TimeoutError):u.wait_ready(REV,u.NEW_SOURCE,False)
            self.assertLessEqual(clock[0],60);self.assertTrue(all(t<=5 for t in calls));command.assert_not_called()

    def test_preflight_checks_marker_directories_and_both_container_names(self):
        from types import SimpleNamespace
        operation=u.Upgrade(REV,SOURCE)
        def info(path):return SimpleNamespace(st_mode=0o40700,st_uid=u.MAIL_UID if path==u.DB.parent else 0)
        with patch.object(u,'private_ancestry'),patch.object(Path,'lstat',info),patch.object(Path,'exists',return_value=False),patch.object(Path,'is_symlink',return_value=False), \
             patch.object(u,'safe_stat',return_value=('marker',)) as marker,patch.object(u,'command',return_value=b'') as command:
            self.assertEqual(operation.check_paths(),('marker',));marker.assert_called_once_with(u.FLAG,0)
            self.assertEqual(command.call_count,2)
            names=' '.join(str(c.args[0]) for c in command.call_args_list)
            self.assertIn('rollback-',names);self.assertIn('failed-',names)
            command.side_effect=[b'',b'private-collision']
            with self.assertRaises(u.CheckFailed) as caught:operation.check_paths()
            self.assertEqual(caught.exception.check,'failed_name');self.assertNotIn('private',json.dumps(u.failure_report(caught.exception,True)))


if __name__=='__main__':unittest.main()
