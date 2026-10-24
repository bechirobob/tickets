import importlib.util,json,pathlib,sqlite3,unittest,shutil
spec=importlib.util.spec_from_file_location('recovery',pathlib.Path(__file__).with_name('recover-puro-first-host-20261024.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fixture():
 d=sqlite3.connect(':memory:');d.row_factory=sqlite3.Row
 schemas=['attendee_notifications(attendee_id,event_slug,kind,source_id)', 'ticket_assignments(attendee_id,ticket_id,status)', 'tickets(id,event_slug,status,order_id)', 'orders(id,status,payment_provider,customer_email)', 'attendee_profiles(id,status,normalized_email,email_verified_at)', 'event_registrations(order_id,event_slug,attendee_id,status,kind,device_claimed_at,verified_at,normalized_email)', 'event_registration_settings(event_slug,room_access)', 'curated_event_records(slug,removed_at,archived_at,status,schedule_status,event_state)', 'room_host_first_posts(event_slug,message_id,sender_attendee_id,host_account_id,created_at,fanout_at,cancelled_at)', 'room_suspensions(event_slug,attendee_id,restored_at)', 'room_blocks(event_slug,blocker_attendee_id,blocked_attendee_id)', 'notification_preferences(event_slug,attendee_id,host_updates,muted_until)', 'push_subscriptions(attendee_id,revoked_at,host_updates)', 'marketing_contacts(email,unsubscribed)', 'event_audience_contacts(event_slug,email,unsubscribed_at,consented_at)', 'delivery_events(id PRIMARY KEY,kind,recipient,status,attempt_count,payload_json,created_at,updated_at,provider_id,failure_reason,next_attempt_at)', 'staff_accounts(id,normalized_email,status,role,must_change_password,locked_until)', 'staff_event_assignments(account_id,event_slug)']
 for schema in schemas:d.execute('CREATE TABLE '+schema)
 d.execute("INSERT INTO attendee_notifications VALUES('guest',?,'host_first_post','message')",(m.SLUG,))
 d.execute("INSERT INTO ticket_assignments VALUES('guest','ticket','active')")
 d.execute("INSERT INTO tickets VALUES('ticket',?,'issued','order')",(m.SLUG,))
 d.execute("INSERT INTO orders VALUES('order','paid','rsvp','booking@example.com')")
 d.execute("INSERT INTO attendee_profiles VALUES('guest','active','edited@example.com',NULL)")
 d.execute("INSERT INTO attendee_profiles VALUES('host','active','host@example.com','verified')")
 d.execute("INSERT INTO event_registrations VALUES('order',?,'guest','confirmed','rsvp','proof',NULL,'booking@example.com')",(m.SLUG,))
 d.execute('INSERT INTO event_registration_settings VALUES(?,1)',(m.SLUG,))
 d.execute("INSERT INTO curated_event_records VALUES(?,NULL,NULL,'published','confirmed','on_sale')",(m.SLUG,))
 d.execute("INSERT INTO room_host_first_posts VALUES(?,'message','host','account',?,'fanout',NULL)",(m.SLUG,m.CREATED))
 d.execute("INSERT INTO staff_accounts VALUES('account','host@example.com','active','organizer',0,NULL)")
 d.execute("INSERT INTO staff_event_assignments VALUES('account',?)",(m.SLUG,));d.commit()
 room=sqlite3.connect(':memory:');room.row_factory=sqlite3.Row;room.execute('CREATE TABLE messages(id,attendee_id,deleted_at)');room.execute("INSERT INTO messages VALUES('message','host',NULL)");room.commit()
 receipt=d.execute('SELECT * FROM room_host_first_posts').fetchone()
 return d,room,receipt,{'provider':'resend','subject':'Approved subject','html':'Approved body','text':'Approved text'}

class Recovery(unittest.TestCase):
 def test_once_and_existing_statuses(self):
  for status in ('delivered','sent','sending','queued','suppressed','uncertain','failed'):
   with self.subTest(status=status):
    d,r,p,t=fixture();key='room-first-email/message/guest';d.execute("INSERT INTO delivery_events(id,kind,recipient,status,payload_json) VALUES(?,'room_host_post','booking@example.com',?,?)",(key,status,json.dumps({'messageId':'message','attendeeId':'guest'})));d.commit()
    result=m.recover(d,r,p,t,lambda *_:self.fail('Existing job resent'))
    self.assertEqual(result['eligibleAtStart'],0);self.assertEqual(d.execute('SELECT status FROM delivery_events').fetchone()[0],status)
 def test_booking_contact_only_and_no_verification_change(self):
  d,r,p,t=fixture();calls=[]
  def send(address,payload):
   calls.append((address,payload));self.assertEqual(d.execute('SELECT status,attempt_count FROM delivery_events').fetchone()[:],('sending',1));return 'receipt'
  self.assertEqual(m.recover(d,r,p,t,send)['accepted'],1)
  self.assertEqual(calls[0][0],'booking@example.com');self.assertEqual(calls[0][1]['html'],t['html'])
  self.assertIsNone(d.execute("SELECT email_verified_at FROM attendee_profiles WHERE id='guest'").fetchone()[0])
  self.assertEqual(m.recover(d,r,p,t,lambda *_:self.fail('Repeat'))['eligibleAtStart'],0)
 def test_suppressions(self):
  mutations=["UPDATE orders SET status='refunded'", "UPDATE tickets SET status='voided'", "UPDATE ticket_assignments SET status='revoked'", "UPDATE event_registrations SET attendee_id='host'", "UPDATE event_registrations SET normalized_email='other@example.com'", "UPDATE event_registrations SET device_claimed_at=NULL", "UPDATE event_registrations SET status='cancelled'", "UPDATE event_registration_settings SET room_access=0", "DELETE FROM staff_event_assignments", "UPDATE staff_accounts SET status='suspended'", "UPDATE curated_event_records SET event_state='cancelled'", "INSERT INTO push_subscriptions VALUES('guest',NULL,1)", "INSERT INTO marketing_contacts VALUES('booking@example.com',1)", "INSERT INTO event_audience_contacts VALUES('puro-exceso-20261024','booking@example.com','2026','2025')", "INSERT INTO delivery_events(id,recipient,status) VALUES('prior','booking@example.com','bounced')", "INSERT INTO delivery_events(id,recipient,status) VALUES('prior','booking@example.com','complained')", "INSERT INTO notification_preferences VALUES('puro-exceso-20261024','guest',0,NULL)", "INSERT INTO room_suspensions VALUES('puro-exceso-20261024','guest',NULL)", "INSERT INTO room_blocks VALUES('puro-exceso-20261024','guest','host')"]
  for sql in mutations:
   with self.subTest(sql=sql):
    d,r,p,t=fixture();d.execute(sql);d.commit();self.assertEqual(m.recover(d,r,p,t,lambda *_:self.fail('Suppressed sent'))['eligibleAtStart'],0)
 def test_push_after_claim(self):
  d,r,p,t=fixture();original=m.eligible;count=0
  def changed(*args,**kwargs):
   nonlocal count
   count+=1
   if count==3:d.execute("INSERT INTO push_subscriptions VALUES('guest',NULL,1)");d.commit()
   return original(*args,**kwargs)
  m.eligible=changed
  try:self.assertEqual(m.recover(d,r,p,t,lambda *_:self.fail('Push opted in'))['suppressedBeforeSend'],1)
  finally:m.eligible=original
  self.assertEqual(d.execute('SELECT status FROM delivery_events').fetchone()[0],'suppressed')
 def test_timeout_stops_without_retry(self):
  d,r,p,t=fixture();calls=[]
  def send(*args):calls.append(args);raise TimeoutError('private address should never reach output')
  self.assertEqual(m.recover(d,r,p,t,send)['uncertain'],1)
  self.assertEqual(m.recover(d,r,p,t,send)['eligibleAtStart'],0);self.assertEqual(len(calls),1)
 def test_deleted_source_and_cap(self):
  d,r,p,t=fixture()
  with self.assertRaises(AssertionError):m.recover(d,r,p,t,lambda *_:'receipt',cap=0)
  r.execute("UPDATE messages SET deleted_at='now'");r.commit()
  with self.assertRaises(AssertionError):m.recover(d,r,p,t,lambda *_:'receipt')
 def test_original_cohort_and_claim_rollback(self):
  d,r,p,t=fixture();d.execute('DELETE FROM attendee_notifications');d.commit()
  self.assertEqual(m.recover(d,r,p,t,lambda *_:self.fail('Late holder'))['eligibleAtStart'],0)
  d,r,p,t=fixture();d.execute("CREATE TRIGGER stop_claim BEFORE INSERT ON delivery_events BEGIN SELECT RAISE(ABORT,'synthetic'); END");d.commit()
  with self.assertRaises(sqlite3.IntegrityError):m.recover(d,r,p,t,lambda *_:self.fail('Failed claim'))
  self.assertEqual(d.execute('SELECT COUNT(*) FROM delivery_events').fetchone()[0],0)
 def test_source_deleted_after_claim(self):
  d,r,p,t=fixture();original=m.visible;count=0
  def changed(*args):
   nonlocal count
   count+=1
   if count==3:r.execute("UPDATE messages SET deleted_at='now'");r.commit()
   return original(*args)
  m.visible=changed
  try:self.assertEqual(m.recover(d,r,p,t,lambda *_:self.fail('Deleted source'))['suppressedBeforeSend'],1)
  finally:m.visible=original
 def test_node_contract_and_receipts(self):
  original=m.NODE_REQUEST
  prefix="""import assert from 'node:assert/strict';globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
   assert.equal(options.headers.authorization,'Bearer synthetic-key');assert.equal(options.headers['idempotency-key'],'normal/key');
   assert.deepEqual(JSON.parse(options.body),{from:'BeCore Tickets <tickets@becoreops.com>',to:['synthetic@example.com'],subject:'Subject',html:'<p>Approved</p>',text:'Approved',reply_to:'tickets@becoreops.com'});
   return new Response(JSON.stringify({id:'synthetic-receipt'}),{status:201});};"""
  m.NODE_REQUEST=prefix+original
  try:self.assertEqual(m.send_node(shutil.which('node'),'synthetic-key','synthetic@example.com',{'subject':'Subject','html':'<p>Approved</p>','text':'Approved','idempotencyKey':'normal/key'}),'synthetic-receipt')
  finally:m.NODE_REQUEST=original
 def test_node_safe_errors_no_retry(self):
  original=m.NODE_REQUEST
  for mock,category in [("throw new Error('private@example.com')",'provider_network_error'),("return new Response('{}',{status:403})",'provider_http_error'),("return new Response('{}',{status:200})",'provider_receipt_invalid')]:
   with self.subTest(category=category):
    m.NODE_REQUEST='globalThis.fetch=async()=>{'+mock+'};'+original
    try:
     with self.assertRaises(m.ProviderFailure) as error:m.send_node(shutil.which('node'),'synthetic-key','synthetic@example.com',{'subject':'Subject','html':'Body','text':'Body','idempotencyKey':'key'})
     self.assertEqual(error.exception.category,category);self.assertTrue(error.exception.handed_off)
    finally:m.NODE_REQUEST=original
  with self.assertRaises(m.ProviderFailure) as error:m.send_node(shutil.which('node'),'synthetic-key','synthetic@example.com',{})
  self.assertFalse(error.exception.handed_off)
 def test_explicit_rejection_private_request_metadata(self):
  original=m.NODE_REQUEST
  m.NODE_REQUEST="globalThis.fetch=async()=>new Response(JSON.stringify({name:'validation_error',message:'private@example.com'}),{status:422,headers:{'x-request-id':'request_123'}});"+original
  try:
   with self.assertRaises(m.ProviderFailure) as error:m.send_node(shutil.which('node'),'synthetic-key','synthetic@example.com',{'subject':'Subject','html':'Body','text':'Body','idempotencyKey':'key'})
   failure=error.exception;self.assertTrue(failure.rejected);self.assertEqual(failure.metadata['status'],422);self.assertEqual(failure.metadata['requestId'],'request_123')
   d,r,p,t=fixture()
   def send(*args):raise failure
   outcome=m.recover(d,r,p,t,send)
   self.assertEqual(outcome['explicitRejections'],1);self.assertNotIn('request_123',json.dumps(outcome));self.assertNotIn('private@example.com',json.dumps(outcome))
   recorded=d.execute('SELECT status,failure_reason FROM delivery_events').fetchone();self.assertEqual(recorded[0],'failed');self.assertIn('request_123',recorded[1]);self.assertNotIn('private@example.com',recorded[1])
  finally:m.NODE_REQUEST=original
 def test_timeout_is_distinct_and_uncertain(self):
  original=m.NODE_REQUEST;m.NODE_REQUEST="globalThis.fetch=async()=>{throw new DOMException('private','TimeoutError')};"+original
  try:
   with self.assertRaises(m.ProviderFailure) as error:m.send_node(shutil.which('node'),'synthetic-key','synthetic@example.com',{'subject':'Subject','html':'Body','text':'Body','idempotencyKey':'key'})
   self.assertEqual(error.exception.category,'provider_timeout');self.assertTrue(error.exception.handed_off);self.assertFalse(error.exception.rejected)
  finally:m.NODE_REQUEST=original
 def test_pre_request_failure_is_known_unsent_and_not_retried(self):
  d,r,p,t=fixture()
  def send(*args):raise m.ProviderFailure('local_input_invalid',False)
  self.assertEqual(m.recover(d,r,p,t,send)['knownUnsentFailures'],1)
  self.assertEqual(d.execute('SELECT status FROM delivery_events').fetchone()[0],'failed')
  self.assertEqual(m.recover(d,r,p,t,lambda *_:self.fail('No automatic retry'))['eligibleAtStart'],0)

if __name__=='__main__':unittest.main()
