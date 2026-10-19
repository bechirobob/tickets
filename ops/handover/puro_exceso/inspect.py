"""Read only the exact Tickets live schema and public host linkage."""
import fcntl, hashlib, json, os, pathlib, sqlite3, subprocess, time, urllib.request
ACTIVE='45ae58430aea3bad312a8244432078a4ffde59f8'
TABLES=('party_submissions','curated_event_records','event_registration_settings','event_hosts','hosts','staff_event_assignments','curation_audit_events')
def main():
    lock=os.open('/run/lock/becore-tickets-deploy.lock',os.O_RDONLY|os.O_NOFOLLOW)
    fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB)
    props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show','becore-tickets.service','--property=ActiveState,WorkingDirectory'],text=True).splitlines())
    assert props=={'ActiveState':'active','WorkingDirectory':'/srv/becore-tickets/releases/'+ACTIVE}
    req=urllib.request.Request('http://127.0.0.1:3119/healthz',headers={'Host':'tickets.becoreops.com'})
    with urllib.request.urlopen(req,timeout=10) as response: health=json.load(response)
    assert health.get('revision')==ACTIVE and health.get('active') is True and health.get('runtime')=='vps'
    path=pathlib.Path('/var/lib/becore-tickets/tickets.sqlite')
    assert path.is_file() and not path.is_symlink()
    db=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=5)
    deadline=time.monotonic()+15;db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
    db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
    assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    schemas={t:[dict(r) for r in db.execute('PRAGMA table_info('+t+')')] for t in TABLES}
    schema_rows=[list(r) for r in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")]
    fingerprint=hashlib.sha256(json.dumps(schema_rows,separators=(',',':')).encode()).hexdigest()
    host=[dict(r) for r in db.execute("SELECT id,slug,name,verification_status FROM hosts WHERE slug='kofi-bills'")]
    duplicate=db.execute("SELECT count(*) FROM curated_event_records WHERE slug='puro-exceso-20261024' OR lower(title)='puro exceso'").fetchone()[0]
    links=[dict(r) for r in db.execute("SELECT eh.event_slug,eh.role,eh.is_primary,e.organizer_owner_id IS NOT NULL AS has_owner FROM event_hosts eh JOIN curated_event_records e ON e.slug=eh.event_slug WHERE eh.host_id='host:kofi-bills'")]
    mapping=[]
    for row in db.execute("""SELECT e.slug, s.organizer_name,s.contact_name,h.full_name,
      a.id,a.display_name,a.role,a.status,e.organizer_owner_id=a.id AS matches_owner,
      EXISTS(SELECT 1 FROM staff_event_assignments x WHERE x.account_id=a.id AND x.event_slug=e.slug) AS assigned
      FROM event_hosts eh JOIN hosts h ON h.id=eh.host_id
      JOIN curated_event_records e ON e.slug=eh.event_slug
      JOIN party_submissions s ON s.id=e.submission_id
      JOIN staff_accounts a ON a.normalized_email=lower(trim(s.contact_email))
      WHERE h.id='host:kofi-bills' AND e.removed_at IS NULL AND e.archived_at IS NULL"""):
        value=dict(row);value['accountHash']=hashlib.sha256(value.pop('id').encode()).hexdigest();mapping.append(value)
    assert db.total_changes==0
    print(json.dumps({'readOnly':True,'revision':ACTIVE,'schemaFingerprint':fingerprint,'databaseBytes':path.stat().st_size,'publicationTriggers':[dict(r) for r in db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'curated_events_verify%'")],'schema':schemas,'host':host,'hostLinks':links,'organizerMapping':mapping,'existingEventMatches':duplicate,'quickCheck':'ok','foreignKeyViolations':0},sort_keys=True))
if __name__=='__main__':main()
