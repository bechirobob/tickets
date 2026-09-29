import { terminalOutcomes } from './worker.mjs';
export function matchTerminalEvidence(records, events) {
  const terminal=new Map(), entered=new Map();
  for(const event of events){
    const request=event.$metadata?.requestId;
    if(!request || event.$workers?.scriptName!=='becore-tickets')continue;
    if(event.$metadata.type==='cf-worker-event' && terminalOutcomes.has(event.$workers.outcome))terminal.set(request,event);
    const entry=event.source;
    if(entry?.kind==='http' && entry.phase==='entered' && typeof entry.handoverOperation==='string')entered.set(entry.handoverOperation,event);
  }
  return records.flatMap(record=>{
    if(record.kind!=='http')return [];
    const log=entered.get(record.id), end=log && terminal.get(log.$metadata.requestId);
    if(!end || !log.$workers.scriptVersion?.id || log.$workers.scriptVersion.id!==end.$workers.scriptVersion?.id)return [];
    return [{record,evidence:{script:'becore-tickets',method:'cloudflare-observability-terminal-match',outcome:end.$workers.outcome,
      requestId:log.$metadata.requestId,enteredEventId:log.$metadata.id,terminalEventId:end.$metadata.id,version:end.$workers.scriptVersion.id,
      observedAt:new Date().toISOString()}}];
  });
}
