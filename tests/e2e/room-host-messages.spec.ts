import AxeBuilder from '@axe-core/playwright';
import {expect, test} from './catalogue';

test.use({serviceWorkers: 'block'});

test('Host announcements use normal bubbles with an authoritative compact tag', async ({page, eventSlug}, info) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const createdAt = new Date().toISOString();
  const room = {eventSlug, eventTitle:'Garden Party', readOnly:false, readOnlyAt:new Date(Date.now()+86400000).toISOString()};
  const base = {createdAt, roomBadge:null, parentId:null, pinned:false, deletedAt:null, reactions:[], kind:'message', role:'attendee'};
  const messages = [
    {...base,id:'pinned',sequence:1,attendeeId:'host',displayName:'Garden team',role:'organizer',kind:'announcement',pinned:true,content:'Your ticket is ready. Come through Gate 2.'},
    {...base,id:'guest',sequence:2,attendeeId:'guest',displayName:'Ama',content:'We’re at the garden entrance. See you soon!'},
    {...base,id:'host',sequence:3,attendeeId:'host',displayName:'Garden team',role:'organizer',kind:'announcement',content:'Water is by the bar. Take a breather before the next set.\nThe garden entrance stays open until 11.'},
    {...base,id:'vip',sequence:4,attendeeId:'vip',displayName:'Kofi',roomBadge:'VIP',content:'Front left. You know the drill.'},
    {...base,id:'self',sequence:5,attendeeId:'self',displayName:'You',content:'On our way!'},
    {...base,id:'impersonator',sequence:6,attendeeId:'another-guest',displayName:'Host',content:'A guest can choose a name, never a host badge.'},
    {...base,id:'removed',sequence:7,attendeeId:'host',displayName:'Garden team',role:'organizer',kind:'announcement',deletedAt:createdAt,content:'Message removed'},
  ];
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/access')) return route.fulfill({json:{allowed:true,attendee:{id:'self'},room}});
    if(path.endsWith('/flashes')) return route.fulfill({json:{flashes:[]}});
    if(path.includes('/notifications/preferences/')) return route.fulfill({json:{hostUpdates:true,roomMessages:true}});
    if(path.endsWith('/notifications/subscription')) return route.fulfill({json:{available:false}});
    return route.fulfill({status:401,json:{error:'Isolated Room fixture'}});
  });
  await page.routeWebSocket(/\/api\/room\/socket/u,socket=>socket.send(JSON.stringify({type:'snapshot',room,messages,online:4})));
  await page.goto(`/room/${eventSlug}`);
  const host=page.locator('.room-message[data-announcement="host"]');
  await expect(host.locator('header > b')).toHaveText('Host');
  await expect(host.locator('.room-host-badge')).toHaveAccessibleName('Event host');
  await expect(host.locator('.room-bubble')).toContainText('The garden entrance stays open until 11.');
  await expect(host.locator('summary, details')).toHaveCount(0);
  // Presentation must not add reply/reaction/report controls to announcements.
  await expect(host.getByRole('button')).toHaveCount(0);
  const guest=page.locator('.room-message').filter({hasText:'We’re at the garden entrance.'});
  for(const property of ['background-color','color','border-radius','padding']) {
    const value=await guest.locator('.room-bubble').evaluate((el,p)=>getComputedStyle(el).getPropertyValue(p),property);
    await expect(host.locator('.room-bubble')).toHaveCSS(property,value);
  }
  await expect(host.locator('.room-bubble')).toHaveCSS('box-shadow','none');
  await expect(page.locator('.room-message').filter({hasText:'A guest can choose a name'}).locator('.room-host-badge')).toHaveCount(0);
  await expect(page.locator('.room-vip-badge')).toHaveAccessibleName('VIP ticket holder');
  await expect(page.locator('.room-message.own .room-bubble')).toHaveCSS('background-color','rgb(233, 203, 182)');
  await expect(page.locator('[data-announcement="removed"] .room-bubble p')).toHaveClass('removed');
  await expect(page.locator('.room-stream')).not.toContainText('Your ticket is ready.');
  await page.locator('.room-pinned summary').click();
  await expect(page.locator('.room-pinned > p')).toBeVisible();
  await page.locator('.room-pinned summary').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await host.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('host-normal-chat.png'),fullPage:true});
  const accessibility = await new AxeBuilder({page}).include('.room-stream').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});
