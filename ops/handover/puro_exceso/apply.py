"""Fixed reviewed listing operation; activation requires approved immutable workflow."""
import fcntl,hashlib,json,os,pathlib,pwd,sqlite3,subprocess,time,urllib.request,uuid
from datetime import datetime,timezone
from event_insert import update_plan_copy,schema_fingerprint
ACTIVE='45ae58430aea3bad312a8244432078a4ffde59f8'
SCHEMA='c57e460354c1a1cef34cc605b198d0ef1c223fd1bbaeb3a4a4c4c77db434a3ea'
OWNER_APPROVAL_AUTHORIZED=True
FLYER_HASH='439ee63370dd489b55c2eda2eb98d7231ab6c185b72d2ab5c28ee8a7892e1d9f'
DB=pathlib.Path('/var/lib/becore-tickets/tickets.sqlite')

def main():
    assert os.geteuid()==0
    assert datetime.now(timezone.utc).isoformat() < '2026-10-24T21:00:00+00:00','Event has started'
    assert OWNER_APPROVAL_AUTHORIZED,'Owner-managed RSVP approval authorization required'
    lock=os.open('/run/lock/becore-tickets-deploy.lock',os.O_RDONLY|os.O_NOFOLLOW)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show','becore-tickets.service','--property=ActiveState,WorkingDirectory'],text=True).splitlines())
    assert props=={'ActiveState':'active','WorkingDirectory':'/srv/becore-tickets/releases/'+ACTIVE}
    req=urllib.request.Request('http://127.0.0.1:3119/healthz',headers={'Host':'tickets.becoreops.com'})
    with urllib.request.urlopen(req,timeout=10) as response:health=json.load(response)
    assert health.get('revision')==ACTIVE and health.get('runtime')=='vps' and health.get('active') is True
    account=pwd.getpwnam('becore-tickets')
    assert DB.is_file() and not DB.is_symlink() and DB.stat().st_uid==account.pw_uid
    flyer=pathlib.Path(__file__).with_name('flyer.jpeg').read_bytes()
    assert hashlib.sha256(flyer).hexdigest()==FLYER_HASH
    directory=DB.parent/('puro-exceso-backup-'+str(uuid.uuid4()))
    directory.mkdir(mode=0o700);os.chown(directory,account.pw_uid,account.pw_gid)
    # All SQLite writes and the local backup run as the existing service user.
    os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid);os.umask(0o077)
    source=sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True,timeout=10)
    assert schema_fingerprint(source)==SCHEMA
    snapshot=directory/'before.sqlite'
    saved=sqlite3.connect(snapshot);source.backup(saved);saved.close();source.close()
    saved=sqlite3.connect('file:'+str(snapshot)+'?mode=ro',uri=True)
    assert saved.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
    assert not saved.execute('PRAGMA foreign_key_check').fetchall()
    assert schema_fingerprint(saved)==SCHEMA;saved.close()
    backup_hash=hashlib.sha256(snapshot.read_bytes()).hexdigest()
    db=sqlite3.connect('file:'+str(DB)+'?mode=rw',uri=True,timeout=10)
    deadline=time.monotonic()+10;db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
    db.execute('PRAGMA foreign_keys=ON')
    owners=db.execute("SELECT id FROM staff_accounts WHERE role='owner' AND status='active'").fetchall()
    assert len(owners)==1,'Unique active owner required'
    result=update_plan_copy(db,expected_schema_fingerprint=SCHEMA)
    db.close()
    receipt={**result,'activeRevision':ACTIVE,'backup':str(snapshot),'backupSha256':backup_hash,'backupIntegrity':'ok'}
    receipt_path=directory/'receipt.json'
    with receipt_path.open('x') as handle:json.dump(receipt,handle,sort_keys=True);handle.flush();os.fsync(handle.fileno())
    print(json.dumps({k:v for k,v in receipt.items() if k!='preserved_tables'},sort_keys=True))
if __name__=='__main__':main()
