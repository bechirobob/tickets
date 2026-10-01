import { describe, expect, it } from 'vitest';
import { boundedFormData, RequestBodyTooLarge } from '../lib/request-body';
import { POST as submitParty } from '../app/api/submissions/route';

function streamed(chunks: Uint8Array[], headers: HeadersInit = {}) {
  let cancelled = false, index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); },
    cancel() { cancelled = true; },
  });
  const request = new Request('https://tickets.becoreops.com/api/submissions', {
    method:'POST', headers:{origin:'https://tickets.becoreops.com','content-type':'multipart/form-data; boundary=test',...headers}, body, duplex:'half',
  } as RequestInit);
  return { request, cancelled:()=>cancelled };
}

describe('actual streamed upload size boundaries',()=>{
  for (const headers of [{},{'content-length':'1'}] as Array<Record<string,string>>) it(`rejects oversized chunks with ${'content-length' in headers ? 'a forged' : 'no'} length header`,async()=>{
    const input=streamed([new Uint8Array(8),new Uint8Array(8),new Uint8Array(8)],headers);
    await expect(boundedFormData(input.request,10)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    expect(input.cancelled()).toBe(true);
  });
  it('parses a valid multipart form exactly at the byte limit',async()=>{
    const body=new TextEncoder().encode('--test\r\nContent-Disposition: form-data; name="title"\r\n\r\nNight\r\n--test--\r\n');
    const input=streamed([body.slice(0,11),body.slice(11)]);
    expect((await boundedFormData(input.request,body.length)).get('title')).toBe('Night');
  });
  it('returns 413 from the public submission handler for a chunked oversized body',async()=>{
    const input=streamed([new Uint8Array(5*1024*1024),new Uint8Array(5*1024*1024),new Uint8Array(1)],{'content-length':'1'});
    expect((await submitParty(input.request)).status).toBe(413);
    expect(input.cancelled()).toBe(true);
  });
});

it('bounds signed webhooks before signature verification or JSON decoding',async()=>{
  const [{POST:paystack},{POST:seev},{POST:email}] = await Promise.all([
    import('../app/api/payments/webhook/route'),import('../app/api/payments/seevplus/webhook/route'),import('../app/api/email/webhook/route'),
  ]);
  for(const [handler,limit] of [[paystack,1024*1024],[email,1024*1024],[seev,65536]] as const){
    const input=streamed([new Uint8Array(limit),new Uint8Array(1),new Uint8Array(1)],{'content-length':'1'});
    const response=await handler(input.request);
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(input.cancelled()).toBe(true);
  }
});

it('preserves exact Unicode and whitespace bytes for webhook signatures',async()=>{
  const {limitRequestBody}=await import('../lib/request-body');
  const bytes=new TextEncoder().encode(' { "name": "Nana 🎟️", "amount": 10 }\r\n');
  const input=streamed([bytes.slice(0,19),bytes.slice(19)]);
  const bounded=await limitRequestBody(input.request,bytes.length);
  expect(bounded).toBeInstanceOf(Request);
  expect(new Uint8Array(await (bounded as Request).arrayBuffer())).toEqual(bytes);
});

it('enforces general API and smaller form token budgets before parser allocation',async()=>{
  const [{POST:analytics},{POST:unsubscribe}]=await Promise.all([import('../app/api/analytics/route'),import('../app/api/announcements/unsubscribe/route')]);
  expect((await analytics(streamed([new Uint8Array(1024*1024+1)]).request)).status).toBe(413);
  expect((await unsubscribe(streamed([new Uint8Array(4097)]).request)).status).toBe(413);
});

it('bounds private recovery and transfer tokens even through delegated body readers',async()=>{
  for(const route of [await import('../app/api/customer/recovery/claim/route'),await import('../app/api/customer/transfers/claim/route')]) {
    expect((await route.POST(streamed([new Uint8Array(513)]).request)).status).toBe(413);
  }
});
