import { describe, expect, it } from 'vitest';
import { GATE_QUEUE_KEY, GATE_REVIEW_KEY, gateConnectionState, persistGateSync, readGateList, selectedGateEvent, type QueuedScan, type GateReview } from '../lib/scanner-sync';
import { safeReturnTo, allowedWorkspaceReturn } from '../lib/admin-session';
function storage(initial: Record<string,string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => { data.set(key,value); } };
}
const scan = (id:string,eventSlug='event-a'):QueuedScan => ({ clientScanId:id,code:'BCT-AAAA-BBBB-CCCC-DDDD',eventSlug,deviceId:'device',gate:'Main gate',ticket:{ticketId:id},savedAt:'2026-09-30T20:00:00Z' });
const review:GateReview={clientScanId:'conflict',eventSlug:'event-a',ticket:{ticketId:'conflict'},savedAt:'2026-09-30T20:00:00Z',recordedAt:'2026-09-30T20:01:00Z',reason:'Already admitted elsewhere'};
describe('durable scanner recovery',()=>{
  it('never equates a network interface with a verified door service',()=>{
    const state={online:true,reachable:false,lastContact:0,now:1000,pending:0,reviews:0,syncing:false};
    expect(gateConnectionState(state)).toBe('disconnected');
    expect(gateConnectionState({...state,reachable:true,lastContact:1000})).toBe('connected');
    expect(gateConnectionState({...state,reachable:true,lastContact:1,now:32000})).toBe('disconnected');
    expect(gateConnectionState({...state,reachable:true,lastContact:1000,pending:2})).toBe('pending');
    expect(gateConnectionState({...state,reachable:true,lastContact:1000,reviews:1})).toBe('review');
    expect(gateConnectionState({...state,online:false,reviews:1})).toBe('offline');
  });
  it('retains review evidence across successful entries and preserves newly appended or other-event entries',()=>{
    const s=storage({[GATE_QUEUE_KEY]:JSON.stringify([scan('ok'),scan('conflict'),scan('new'),scan('other','event-b')])});
    const result=persistGateSync(s,new Set(['ok','conflict']),[review]);
    expect(result.remaining.map(x=>x.clientScanId)).toEqual(['new','other']);
    expect(readGateList(s,GATE_REVIEW_KEY)).toEqual([review]);
    expect(s.getItem(GATE_REVIEW_KEY)).not.toContain('BCT-');
  });
  it('does not erase queued work when a conflict cannot be persisted',()=>{
    const s=storage({[GATE_QUEUE_KEY]:JSON.stringify([scan('conflict')])});
    const failing={...s,setItem:(key:string,value:string)=>{if(key===GATE_REVIEW_KEY)throw new Error('Quota exceeded');s.setItem(key,value);}};
    expect(()=>persistGateSync(failing,new Set(['conflict']),[review])).toThrow('Quota exceeded');
    expect(readGateList<QueuedScan>(s,GATE_QUEUE_KEY)[0].clientScanId).toBe('conflict');
  });
  it('keeps recorded review evidence if the subsequent queue write fails',()=>{
    const s=storage({[GATE_QUEUE_KEY]:JSON.stringify([scan('conflict')])});
    const failing={...s,setItem:(key:string,value:string)=>{if(key===GATE_QUEUE_KEY)throw new Error('Quota exceeded');s.setItem(key,value);}};
    expect(()=>persistGateSync(failing,new Set(['conflict']),[review])).toThrow();
    expect(readGateList(s,GATE_REVIEW_KEY)).toEqual([review]);
    const retried=persistGateSync(s,new Set(['conflict']),[review]);
    expect(retried.reviews).toHaveLength(1);expect(retried.remaining).toHaveLength(0);
  });
  it('refuses to replace unreadable saved records with an empty list',()=>{
    const s=storage({[GATE_QUEUE_KEY]:'not JSON'});
    expect(()=>persistGateSync(s,new Set(),[])).toThrow();
    expect(s.getItem(GATE_QUEUE_KEY)).toBe('not JSON');
    s.setItem(GATE_QUEUE_KEY,'[null]');
    expect(()=>readGateList(s,GATE_QUEUE_KEY)).toThrow('saved door records');
    expect(s.getItem(GATE_QUEUE_KEY)).toBe('[null]');
  });
  it('selects an exact allowed event and never grants access from a URL',()=>{
    const events=[{slug:'first'},{slug:'assigned'}];
    expect(selectedGateEvent(events,'assigned')).toBe('assigned');
    expect(selectedGateEvent(events,'unassigned')).toBe('first');
    expect(selectedGateEvent([], 'assigned')).toBe('');
  });
  it('preserves a scanner event through sign-in without opening another workspace or origin',()=>{
    const target='/scan?event=assigned';
    expect(safeReturnTo(target)).toBe(target);
    expect(allowedWorkspaceReturn('gate',target)).toBe(target);
    expect(allowedWorkspaceReturn('organizer',target)).toBe('/organizer/workspace');
    expect(safeReturnTo('//evil.example/scan')).toBe('/admin');
    expect(safeReturnTo('/scanner?event=assigned')).toBe('/admin');
  });
});
