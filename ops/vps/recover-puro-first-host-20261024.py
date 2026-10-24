"""One bounded original-receipt recovery. Never retry an existing outbox ID."""
import datetime, fcntl, hashlib, json, os, pathlib, pwd, sqlite3, subprocess, time, urllib.request
SLUG = 'puro-exceso-20261024'
REVISION = '8f43707d9f656b5638659acb9e25595e8903797a'
CREATED = '2026-10-24T11:24:04.728Z'
LIMIT = 1
# Set only from the independently observed existing provider dashboard.
QUOTA_CHECKED_AT = '2026-10-24T12:40:54Z'
QUOTA_DAILY_USED = 80
QUOTA_DAILY_LIMIT = 100
QUOTA_MONTHLY_USED = 85
QUOTA_MONTHLY_LIMIT = 3000
FROM = 'BeCore Tickets <tickets@becoreops.com>'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def eligible(db, receipt, attendee=None):
    # Notification eligibility only: never verifies a profile or grants access.
    sql = """SELECT DISTINCT a.attendee_id,r.normalized_email AS recipient
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
        AND a.attendee_id<>receipt.sender_attendee_id AND (? IS NULL OR a.attendee_id=?)
        AND NOT EXISTS(SELECT 1 FROM room_suspensions s WHERE s.event_slug=t.event_slug AND s.attendee_id=a.attendee_id AND s.restored_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM room_blocks b WHERE b.event_slug=t.event_slug AND b.blocker_attendee_id=a.attendee_id AND b.blocked_attendee_id=receipt.sender_attendee_id)
        AND NOT EXISTS(SELECT 1 FROM notification_preferences f WHERE f.event_slug=t.event_slug AND f.attendee_id=a.attendee_id AND (f.host_updates=0 OR f.muted_until>?))
        AND NOT EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.attendee_id=a.attendee_id AND s.revoked_at IS NULL AND s.host_updates=1)
        AND NOT EXISTS(SELECT 1 FROM marketing_contacts m WHERE m.email=r.normalized_email AND m.unsubscribed=1)
        AND NOT EXISTS(SELECT 1 FROM event_audience_contacts c WHERE c.event_slug=t.event_slug AND c.email=r.normalized_email AND c.unsubscribed_at IS NOT NULL AND c.unsubscribed_at>=COALESCE(c.consented_at,''))
        AND NOT EXISTS(SELECT 1 FROM delivery_events d WHERE d.recipient=r.normalized_email AND d.status IN ('bounced','complained'))
        AND EXISTS(SELECT 1 FROM staff_accounts host JOIN staff_event_assignments assigned ON assigned.account_id=host.id
          JOIN attendee_profiles sender ON sender.normalized_email=host.normalized_email AND sender.status='active' AND sender.email_verified_at IS NOT NULL
          WHERE host.id=receipt.host_account_id AND sender.id=receipt.sender_attendee_id AND assigned.event_slug=receipt.event_slug
            AND host.status='active' AND host.role='organizer' AND host.must_change_password=0 AND (host.locked_until IS NULL OR host.locked_until<=?))
      ORDER BY a.attendee_id"""
    stamp=now()
    rows=db.execute(sql,(SLUG,receipt['message_id'],CREATED,attendee,attendee,stamp,stamp)).fetchall()
    assert len({row['attendee_id'] for row in rows})==len(rows), 'Ambiguous booking contacts'
    return rows

def visible(room, receipt):
    row=room.execute('SELECT attendee_id,deleted_at FROM messages WHERE id=?',(receipt['message_id'],)).fetchone()
    return row is not None and row['attendee_id']==receipt['sender_attendee_id'] and row['deleted_at'] is None

def existing(db, receipt, attendee):
    return db.execute("SELECT 1 FROM delivery_events WHERE id=? OR (kind='room_host_post' AND json_extract(payload_json,'$.messageId')=? AND json_extract(payload_json,'$.attendeeId')=?) LIMIT 1",(f"room-first-email/{receipt['message_id']}/{attendee}",receipt['message_id'],attendee)).fetchone() is not None

def recover(db, room, receipt, template, sender, cap=LIMIT):
    assert receipt['created_at']==CREATED and receipt['cancelled_at'] is None and receipt['fanout_at']
    assert 0 <= (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(CREATED.replace('Z','+00:00'))).total_seconds() < 86400
    assert visible(room,receipt), 'Source unavailable'
    candidates=[dict(row) for row in eligible(db,receipt) if not existing(db,receipt,row['attendee_id'])]
    assert len(candidates)<=cap<=LIMIT, 'Recovery cohort exceeds reviewed cap'
    outcome={'eligibleAtStart':len(candidates),'accepted':0,'uncertain':0,'suppressedBeforeSend':0,'alreadyExists':0,'knownUnsentFailures':0,'explicitRejections':0}
    for candidate in candidates:
        attendee=candidate['attendee_id'];identifier=f"room-first-email/{receipt['message_id']}/{attendee}"
        payload={**template,'attendeeId':attendee,'idempotencyKey':identifier}
        # Directly insert a claimed sending row. The old scheduled worker cannot
        # suppress a queued row between this operator's eligibility and claim.
        db.execute('BEGIN IMMEDIATE')
        try:
            if existing(db,receipt,attendee):
                db.rollback();outcome['alreadyExists']+=1;continue
            current=eligible(db,receipt,attendee)
            if len(current)!=1 or current[0]['recipient']!=candidate['recipient'] or not visible(room,receipt):
                db.rollback();outcome['suppressedBeforeSend']+=1;continue
            stamp=now()
            db.execute("INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,created_at,updated_at) VALUES(?,'room_host_post',?,'sending',1,?,?,?)",(identifier,candidate['recipient'],json.dumps(payload),stamp,stamp))
            db.commit()
        except Exception:
            db.rollback();raise
        # Recheck after claim, immediately before provider handoff. Do not hold
        # a database write lock across a network operation.
        current=eligible(db,receipt,attendee)
        if len(current)!=1 or current[0]['recipient']!=candidate['recipient'] or not visible(room,receipt):
            db.execute("UPDATE delivery_events SET status='suppressed',updated_at=? WHERE id=? AND status='sending'",(now(),identifier));db.commit();outcome['suppressedBeforeSend']+=1;continue
        try:
            provider_id=sender(candidate['recipient'],payload)
            assert isinstance(provider_id,str) and 0<len(provider_id)<=256
            db.execute("UPDATE delivery_events SET status='sent',provider_id=?,failure_reason=NULL,updated_at=? WHERE id=? AND status='sending'",(provider_id,now(),identifier));db.commit();outcome['accepted']+=1
        except Exception as error:
            metadata=error.metadata if isinstance(error,ProviderFailure) else {'category':'provider_outcome_uncertain','phase':'request'}
            # Actionable structured metadata stays linked privately to the
            # outbox record. Public result omits provider request identifiers.
            outcome['failure']={k:v for k,v in metadata.items() if k!='requestId'}
            known_local=isinstance(error,ProviderFailure) and not error.handed_off
            rejected=isinstance(error,ProviderFailure) and error.rejected
            state='failed' if known_local or rejected else 'uncertain'
            db.execute("UPDATE delivery_events SET status=?,failure_reason=?,next_attempt_at=NULL,updated_at=? WHERE id=? AND status='sending'",(state,json.dumps(metadata,sort_keys=True),now(),identifier));db.commit()
            outcome['knownUnsentFailures' if known_local else 'explicitRejections' if rejected else 'uncertain']+=1
            break
    return outcome

class ProviderFailure(Exception):
    def __init__(self, category, handed_off=True, metadata=None, rejected=False):
        self.category=category;self.handed_off=handed_off;self.metadata=metadata or {'phase':'request' if handed_off else 'input','category':category};self.rejected=rejected

# Exact deployed application's fetch contract. Secrets and recipients are sent
# through private stdin, never command arguments, files or public stdout.
NODE_REQUEST = r"""
let started=false,phase='input';
try {
  let raw='';
  for await (const chunk of process.stdin) { raw+=chunk; if(raw.length>2097152) throw new Error(); }
  const input=JSON.parse(raw);
  if(typeof input.key!=='string'||!input.key||typeof input.idempotencyKey!=='string'||!input.message)throw new Error();
  const body=input.rawBody??JSON.stringify(input.message);
  if(typeof body!=='string'||JSON.stringify(JSON.parse(body))!==JSON.stringify(input.message))throw new Error();
  started=true;phase='request';
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{authorization:`Bearer ${input.key}`,'content-type':'application/json','idempotency-key':input.idempotencyKey},body
  });
  phase='response';
  const result=await response.json().catch(()=>null);
  const requestId=response.headers.get('x-request-id')??response.headers.get('request-id');
  const metadata={phase,status:response.status};
  if(requestId&&/^[A-Za-z0-9_-]{1,128}$/.test(requestId))metadata.requestId=requestId;
  const allowedCodes=new Set(['validation_error','restricted_api_key','invalid_api_key','rate_limit_exceeded','invalid_idempotent_request','concurrent_idempotent_requests','not_found','missing_api_key','application_error']);
  if(result&&allowedCodes.has(result.name))metadata.code=result.name;
  if(!response.ok){
    const rejected=[400,401,403,404,405,413,422,429].includes(response.status)&&Boolean(metadata.code)&&!result?.id;
    console.log(JSON.stringify({ok:false,handedOff:true,rejected,category:'provider_http_error',metadata}));
  } else if(!result||typeof result.id!=='string'||!result.id||result.id.length>256){
    console.log(JSON.stringify({ok:false,handedOff:true,category:'provider_receipt_invalid',metadata:{...metadata,phase:'receipt'}}));
  } else console.log(JSON.stringify({ok:true,id:result.id}));
} catch(error) {
  const category=!started?'local_input_invalid':error?.name==='TimeoutError'||error?.name==='AbortError'?'provider_timeout':'provider_network_error';
  console.log(JSON.stringify({ok:false,handedOff:started,category,metadata:{phase,category}}));
}
"""

def request_packet(api_key,recipient,payload,raw_body=None):
    assert isinstance(api_key,str) and api_key
    assert isinstance(recipient,str) and 3<=len(recipient)<=254 and '@' in recipient
    assert all(isinstance(payload.get(k),str) and payload[k] for k in ('subject','html','text','idempotencyKey'))
    message={'from':FROM,'to':[recipient],'subject':payload['subject'],'html':payload['html'],'text':payload['text'],'reply_to':'tickets@becoreops.com'}
    value={'key':api_key,'idempotencyKey':payload['idempotencyKey'],'message':message}
    if raw_body is not None:
        assert json.loads(raw_body)==message
        value['rawBody']=raw_body
    packet=json.dumps(value)
    assert len(packet.encode())<=2097152
    return packet

def send_node(executable,api_key,recipient,payload,raw_body=None):
    try:packet=request_packet(api_key,recipient,payload,raw_body)
    except Exception:raise ProviderFailure('local_input_invalid',False) from None
    try:
        result=subprocess.run([str(executable),'--input-type=module','-e',NODE_REQUEST],input=packet,text=True,capture_output=True,timeout=15,check=False)
        response=json.loads(result.stdout)
    except Exception:raise ProviderFailure('provider_transport_uncertain') from None
    if result.returncode!=0 or not isinstance(response,dict):raise ProviderFailure('provider_transport_uncertain')
    if response.get('ok') is True and isinstance(response.get('id'),str) and 0<len(response['id'])<=256:return response['id']
    category=response.get('category')
    if category not in ('provider_http_error','provider_receipt_invalid','provider_transport_uncertain','provider_timeout','provider_network_error','local_input_invalid'):category='provider_transport_uncertain'
    metadata=response.get('metadata') or {}
    safe={'category':category,'phase':metadata.get('phase') if metadata.get('phase') in ('input','request','response','receipt') else 'request'}
    if isinstance(metadata.get('status'),int) and 100<=metadata['status']<=599:safe['status']=metadata['status']
    if metadata.get('code') in ('validation_error','restricted_api_key','invalid_api_key','rate_limit_exceeded','invalid_idempotent_request','concurrent_idempotent_requests','not_found','missing_api_key','application_error'):safe['code']=metadata['code']
    import re
    if isinstance(metadata.get('requestId'),str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}',metadata['requestId']):safe['requestId']=metadata['requestId']
    raise ProviderFailure(category,response.get('handedOff') is not False,safe,response.get('rejected') is True)

def legacy_body(recipient,payload):
    # Exact original public operator c2ceac8 serializer: key order, separators,
    # ensure_ascii default and UTF-8 bytes are intentionally unchanged.
    return json.dumps({'from':FROM,'to':[recipient],'subject':payload['subject'],'html':payload['html'],'text':payload['text'],'reply_to':'tickets@becoreops.com'})

def reconcile_one(db,room,receipt,template,sender):
    rows=db.execute("""SELECT * FROM delivery_events WHERE kind='room_host_post' AND status='uncertain'
      AND provider_id IS NULL AND attempt_count=1 AND created_at>='2026-10-24T12:17:54.000Z' AND created_at<'2026-10-24T12:17:55.000Z'
      AND json_extract(payload_json,'$.eventSlug')=? AND json_extract(payload_json,'$.messageId')=?""",(SLUG,receipt['message_id'])).fetchall()
    assert len(rows)==1,'Expected exact original uncertain attempt'
    row=rows[0];payload=json.loads(row['payload_json']);attendee=payload['attendeeId']
    assert row['id']==payload['idempotencyKey']==f"room-first-email/{receipt['message_id']}/{attendee}"
    assert {k:v for k,v in payload.items() if k not in ('attendeeId','idempotencyKey')}==template
    elapsed=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(row['created_at'].replace('Z','+00:00'))).total_seconds()
    assert 0<=elapsed<3600, 'Reconciliation must remain well inside provider 24-hour retention'
    assert receipt['created_at']==CREATED and receipt['cancelled_at'] is None and visible(room,receipt)
    current=eligible(db,receipt,attendee)
    if len(current)!=1 or current[0]['recipient']!=row['recipient']:return {'reconciled':0,'eligibilityChanged':1}
    raw=legacy_body(row['recipient'],payload)
    # Manual, exact-row reconciliation only. Normal queue recovery still never
    # retries uncertain jobs. Same key/body makes provider replay duplicate-safe.
    db.execute('BEGIN IMMEDIATE')
    try:
        current=eligible(db,receipt,attendee)
        assert len(current)==1 and current[0]['recipient']==row['recipient'] and visible(room,receipt)
        changed=db.execute("UPDATE delivery_events SET status='sending',attempt_count=2,updated_at=? WHERE id=? AND status='uncertain' AND attempt_count=1 AND provider_id IS NULL AND payload_json=?",(now(),row['id'],row['payload_json'])).rowcount
        assert changed==1
        db.commit()
    except Exception:db.rollback();raise
    current=eligible(db,receipt,attendee)
    if len(current)!=1 or current[0]['recipient']!=row['recipient'] or not visible(room,receipt):
        db.execute("UPDATE delivery_events SET status='uncertain',updated_at=? WHERE id=? AND status='sending'",(now(),row['id']));db.commit();return {'reconciled':0,'eligibilityChanged':1}
    try:
        provider_id=sender(row['recipient'],payload,raw)
        assert isinstance(provider_id,str) and 0<len(provider_id)<=256
        db.execute("UPDATE delivery_events SET status='sent',provider_id=?,failure_reason=NULL,updated_at=? WHERE id=? AND status='sending' AND attempt_count=2",(provider_id,now(),row['id']));db.commit()
        return {'reconciled':1,'providerAcceptedOrCached':1,'otherJobsTouched':0}
    except Exception as error:
        metadata=error.metadata if isinstance(error,ProviderFailure) else {'phase':'request','category':'provider_outcome_uncertain'}
        # A conflict, explicit rejection or any other failure cannot prove the
        # first attempt absent. Keep this row uncertain; never change its key.
        db.execute("UPDATE delivery_events SET status='uncertain',failure_reason=?,updated_at=? WHERE id=? AND status='sending'",(json.dumps(metadata,sort_keys=True),now(),row['id']));db.commit()
        return {'reconciled':0,'uncertain':1,'failure':{k:v for k,v in metadata.items() if k!='requestId'}}

def main():
    os.umask(0o077)
    age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(QUOTA_CHECKED_AT.replace('Z','+00:00'))).total_seconds()
    assert 0<=age<900 and QUOTA_DAILY_LIMIT-QUOTA_DAILY_USED>=LIMIT and QUOTA_MONTHLY_LIMIT-QUOTA_MONTHLY_USED>=LIMIT, 'Fresh free quota evidence required'
    lock=os.open('/run/lock/becore-tickets-deploy.lock',os.O_RDONLY|os.O_NOFOLLOW)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    props=dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show','becore-tickets.service','--property=ActiveState,WorkingDirectory,User'],text=True).splitlines())
    assert props['ActiveState']=='active' and props['WorkingDirectory']=='/srv/becore-tickets/releases/'+REVISION
    assert props['User'] and props['User']!='root'
    req=urllib.request.Request('http://127.0.0.1:3119/healthz',headers={'Host':'tickets.becoreops.com'})
    with urllib.request.urlopen(req,timeout=10) as response: health=json.load(response)
    assert health.get('revision')==REVISION and health.get('runtime')=='vps' and health.get('active') is True
    config=pathlib.Path('/etc/becore-tickets/runtime.json');st=config.lstat()
    assert config.is_file() and not config.is_symlink() and st.st_mode&0o077==0
    values=json.loads(config.read_text())
    assert values.get('EMAIL_FROM')==FROM and values.get('RESEND_API_KEY')
    assert values.get('ROOM_HOST_FIRST_POST_ENABLED')=='1' and values.get('ROOM_HOST_FIRST_POST_EVENT_SLUG')==SLUG
    user=pwd.getpwnam(props['User']);os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
    database=pathlib.Path('/var/lib/becore-tickets/tickets.sqlite')
    roompath=database.parent/'rooms'/(hashlib.sha256(SLUG.encode()).hexdigest()+'.sqlite')
    assert all(p.is_file() and not p.is_symlink() for p in (database,roompath))
    db=sqlite3.connect('file:'+str(database)+'?mode=rw',uri=True,timeout=5);db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA synchronous=FULL')
    room=sqlite3.connect('file:'+str(roompath)+'?mode=ro',uri=True,timeout=5);room.row_factory=sqlite3.Row;room.execute('PRAGMA query_only=ON')
    rows=db.execute('SELECT * FROM room_host_first_posts WHERE event_slug=?',(SLUG,)).fetchall();assert len(rows)==1
    receipt=rows[0];assert receipt['host_account_id']==values.get('ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID')
    samples=db.execute("SELECT payload_json FROM delivery_events WHERE kind='room_host_post' AND status='delivered' AND json_extract(payload_json,'$.eventSlug')=? AND json_extract(payload_json,'$.messageId')=?",(SLUG,receipt['message_id'])).fetchall()
    assert len(samples)==76, 'Verified delivered cohort changed'
    templates=[]
    for row in samples:
        payload=json.loads(row['payload_json']);payload.pop('attendeeId',None);payload.pop('idempotencyKey',None);templates.append(payload)
    template=templates[0];assert all(t==template for t in templates)
    assert template['provider']=='resend' and template['eventSlug']==SLUG and template['messageId']==receipt['message_id']
    assert template['hostAccountId']==receipt['host_account_id'] and template['senderAttendeeId']==receipt['sender_attendee_id']
    assert template['subject']=='PURO EXCESO · Your host has posted'
    executable=pathlib.Path(props['WorkingDirectory'])/'bin/node'
    assert executable.is_file() and os.access(executable,os.X_OK)
    def send(recipient,payload,raw):
        provider_id=send_node(executable,values['RESEND_API_KEY'],recipient,payload,raw_body=raw)
        time.sleep(0.6)
        return provider_id
    # Private same-host recoverable snapshot before any outbox change. Never
    # overwrite an earlier recovery snapshot or upload it to CI artifacts.
    backup_path=database.parent/'first-host-reconcile-one-20261024.sqlite'
    fd=os.open(backup_path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600);os.close(fd)
    backup=sqlite3.connect(backup_path);db.backup(backup)
    assert backup.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    backup.close()
    result=reconcile_one(db,room,receipt,template,send)
    room.close();db.close()
    print(json.dumps({'eventSlug':SLUG,'activeRevision':REVISION,'observedAt':now(),'accountVerificationChanges':0,'manualExactIdempotentReconciliation':True,**result},sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception:
        # Configuration/provider exceptions can contain private information.
        print(json.dumps({'recovery':'stopped','reason':'precondition_or_operation_failed','automaticRetry':False}))
        raise SystemExit(1)
