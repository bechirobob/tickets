"""Read-only public proof after fixed listing insertion; never submit a RSVP."""
import hashlib,json,subprocess
from event_insert import PLAN_COPY,MAP_URL
ORIGIN='https://tickets.becoreops.com'
SLUG='puro-exceso-20261024'
def read(path):
    return subprocess.check_output(['curl','--fail','--silent','--show-error','--max-time','20',ORIGIN+path])
def main():
    data=json.loads(read('/api/public/events?verify=puro-exceso-20261024'))
    screens=[x for x in data['screens'] if x['event']['slug']==SLUG]
    assert len(screens)==1,'Listing missing or duplicated; inspect before retrying any mutation'
    screen=screens[0];event=screen['event'];registration=screen['registration']
    assert (event['title'],event['venue'],event['startsAt'],event['endsAt'],event['scheduleStatus'])==('PURO EXCESO','CINCO','2026-10-24T21:00:00.000Z','2026-10-25T04:00:00.000Z','confirmed')
    assert (registration['mode'],registration['open'],registration['approvalRequired'],registration['maxPartySize'],registration['roomAccess'])==('rsvp',True,True,1,True)
    assert any(h['slug']=='kofi-bills' for h in screen['hosts'])
    assert event['venueMapUrl']==MAP_URL
    assert event['note']==PLAN_COPY and 'Booking and reservations' not in event['note']
    assert event['image']=='/api/media/listing:puro-exceso-20261024'
    assert hashlib.sha256(read(event['image'])).hexdigest()=='439ee63370dd489b55c2eda2eb98d7231ab6c185b72d2ab5c28ee8a7892e1d9f'
    html=read('/event/'+SLUG).decode()
    assert 'href="'+MAP_URL+'"' in html and 'event-detail-venue' in html
    assert 'PURO EXCESO' in html and 'maintenance.becoreops.com' not in html
    print(json.dumps({'publicListingVerified':True,'slug':SLUG,'rsvpOpen':True,'approvalRequired':True,'flyerVerified':True}))
if __name__=='__main__':main()
