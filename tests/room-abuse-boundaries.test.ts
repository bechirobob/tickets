import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { hashToken } from '../lib/attendee-auth';
import { ROOM_MAX_CONNECTIONS, ROOM_MAX_CONNECTIONS_PER_ATTENDEE } from '../worker/the-room';

const future = () => new Date(Date.now()+86_400_000).toISOString();
async function connect(room: DurableObjectStub<import('../worker/the-room').TheRoom>, slug: string, attendee: string, session = attendee, slowMode = 0) {
  const response = await room.fetch(new Request('https://room.internal/socket',{headers:{
    upgrade:'websocket','x-bct-room-authorized':'1','x-bct-attendee-id':attendee,'x-bct-session-id':session,
    'x-bct-display-name':'Test guest','x-bct-event-slug':slug,'x-bct-event-title':'Room limits',
    'x-bct-starts-at':new Date().toISOString(),'x-bct-ends-at':future(),'x-bct-read-only-at':future(),
    'x-bct-slow-mode-seconds':String(slowMode),
  }}));
  expect(response.status).toBe(101);
  const socket=response.webSocket!;
  const ready=socket.readyState===WebSocket.CLOSED ? Promise.resolve(false) : new Promise<boolean>(resolve=>{
    const closed=(event:CloseEvent)=>{socket.removeEventListener('message',message);expect(event.code).toBe(1013);resolve(false);};
    const message=(event:MessageEvent)=>{if(JSON.parse(String(event.data)).type==='snapshot'){socket.removeEventListener('message',message);socket.removeEventListener('close',closed);resolve(true);}};
    socket.addEventListener('message',message);
    socket.addEventListener('close',closed,{once:true});
  });
  socket.accept();
  return {socket,accepted:await ready};
}
const close = (socket:WebSocket) => {if(socket.readyState===WebSocket.OPEN) socket.close(1000,'Test complete');};

it('limits simultaneous guest connections without evicting existing tabs, and releases a closed slot',async()=>{
  const slug=`room-sockets-${crypto.randomUUID()}`,room=env.THE_ROOM.getByName(slug),sockets:WebSocket[]=[];
  try {
    for(let i=0;i<ROOM_MAX_CONNECTIONS_PER_ATTENDEE;i++){const client=await connect(room,slug,'same-guest');expect(client.accepted).toBe(true);sockets.push(client.socket);}
    const rejected=await connect(room,slug,'same-guest');expect(rejected.accepted).toBe(false);
    expect(sockets.every(socket=>socket.readyState===WebSocket.OPEN)).toBe(true);
    close(sockets.pop()!);
    const replacement=await connect(room,slug,'same-guest');expect(replacement.accepted).toBe(true);sockets.push(replacement.socket);
  } finally {sockets.forEach(close);}
});

it('keeps 600 guest admission headroom and rejects only new sockets at the hard Room ceiling',async()=>{
  const slug=`room-capacity-${crypto.randomUUID()}`,room=env.THE_ROOM.getByName(slug),sockets:WebSocket[]=[];
  expect(ROOM_MAX_CONNECTIONS).toBeGreaterThan(600*3);
  try {
    for(let offset=0;offset<ROOM_MAX_CONNECTIONS;offset+=100){
      const clients=await Promise.all(Array.from({length:Math.min(100,ROOM_MAX_CONNECTIONS-offset)},(_,i)=>connect(room,slug,`guest-${offset+i}`)));
      expect(clients.every(client=>client.accepted)).toBe(true);sockets.push(...clients.map(client=>client.socket));
      if(offset===500)expect(sockets).toHaveLength(600);
    }
    const extra=await connect(room,slug,'overflow-guest');expect(extra.accepted).toBe(false);
    expect(sockets.every(socket=>socket.readyState===WebSocket.OPEN)).toBe(true);
    close(sockets.pop()!);
    const reconnect=await connect(room,slug,'overflow-guest');expect(reconnect.accepted).toBe(true);sockets.push(reconnect.socket);
  } finally {sockets.forEach(close);}
},60_000);

async function attendeeFixture() {
  const id=crypto.randomUUID(),slug=`room-budget-${id}`,now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
      SELECT ?,?,?,title,venue,area,?,?,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',?,?,? FROM curated_event_records WHERE slug='after-dark-osu'`).bind(id,id,slug,now,future(),now,now,now),
    env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES(?,?,'Guest','active',?,?)").bind(id,`${id}@example.com`,now,now),
    env.DB.prepare('INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(id,id,await hashToken(id),future(),now,now),
    env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES(?,?,?,1,100,0,100,'GHS',?,'233000000000','card','paid',?,?)").bind(id,id,slug,`${id}@example.com`,now,now),
    env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)").bind(id,id,slug,id,now),
    env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'fixture','active',?)").bind(id,id,now),
  ]);
  return {id,slug,room:env.THE_ROOM.getByName(slug)};
}
async function send(socket:WebSocket,content:string) {
  const result=new Promise<{type:string;error?:string}>(resolve=>{
    const listener=(event:MessageEvent)=>{const value=JSON.parse(String(event.data));if(value.type==='error'||value.type==='message'&&value.message.content===content){socket.removeEventListener('message',listener);resolve(value);}};
    socket.addEventListener('message',listener);
  });
  socket.send(JSON.stringify({type:'message',content}));return result;
}

it('shares message limits across tabs and rapid reconnects, resets after its window, and still revokes access',async()=>{
  const f=await attendeeFixture(),clients:WebSocket[]=[];
  try {
    for(let i=0;i<4;i++)clients.push((await connect(f.room,f.slug,f.id)).socket);
    for(let i=0;i<5;i++)expect((await send(clients[i%4],`Allowed ${i}`)).type).toBe('message');
    expect((await send(clients[1],'Extra tab attempt')).error).toContain('Slow down');
    clients.forEach(close);clients.length=0;
    const reconnected=(await connect(f.room,f.slug,f.id)).socket;clients.push(reconnected);
    expect((await send(reconnected,'Reconnect attempt')).error).toContain('Slow down');
    await new Promise(resolve=>setTimeout(resolve,10_100));
    expect((await send(reconnected,'After cooldown')).type).toBe('message');
    await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),f.id).run();
    const closed=new Promise<number>(resolve=>reconnected.addEventListener('close',event=>resolve(event.code),{once:true}));
    reconnected.send(JSON.stringify({type:'reaction',messageId:'nonexistent',emoji:'🔥'}));
    expect(await closed).toBe(4003);
  } finally {clients.forEach(close);}
},20_000);

it('shares slow-mode timing across a guest’s devices',async()=>{
  const f=await attendeeFixture(),a=(await connect(f.room,f.slug,f.id,f.id,30)).socket,b=(await connect(f.room,f.slug,f.id,f.id,30)).socket;
  try {expect((await send(a,'First device')).type).toBe('message');expect((await send(b,'Second device')).error).toContain('Slow mode');}
  finally {close(a);close(b);}
});
