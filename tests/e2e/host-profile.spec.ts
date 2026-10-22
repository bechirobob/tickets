import {test,expect} from './analytics-fixture';
import AxeBuilder from '@axe-core/playwright';

test('Kofi Bills profile shows the portrait, public socials without the temporarily unlisted event',async({page})=>{
  await page.goto('/hosts');
  const kofi = page.locator('.hosts-list article').filter({ has: page.getByRole('heading', { name: 'Kofi Bills', exact: true }) });
  await expect(kofi).toContainText('Verified host');
  await expect(kofi).not.toContainText('Reviewed Host');
  await page.getByRole('link',{name:'View Host',exact:true}).click();
  await expect(page).toHaveURL(/\/hosts\/kofi-bills$/);
  await expect(page.getByRole('heading',{name:'Kofi Bills',exact:true})).toBeVisible();
  await expect(page.locator('.host-profile__identity')).toContainText('Verified host');
  await expect(page.locator('.host-profile__identity')).not.toContainText('Henry Yorke');
  await expect(page.locator('.host-profile__bio')).toContainText('Henry Yorke');
  await expect(page.locator('.host-profile__portrait .host-portrait__image')).toBeVisible();
  await expect.poll(() => page.locator('.host-profile__portrait .host-portrait__image').evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  await expect(page.getByRole('link',{name:/Instagram/})).toHaveAttribute('href','https://www.instagram.com/mr.yorke/');
  await expect(page.getByRole('link',{name:/Snapchat/})).toHaveAttribute('href','https://www.snapchat.com/add/kofi_billz123');
  await expect(page.getByRole('heading',{name:'On The Guest List',exact:true})).toHaveCount(0);
  await expect(page.locator('a[href="/event/sun-chasers-labadi"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({page}).include('.host-profile').analyze()).violations).toEqual([]);
  await page.screenshot({path:`test-results/kofi-bills-${test.info().project.name}.png`,fullPage:true});
});

test('confirmed October RSVP respects its opening and avoids paid checkout',async({page})=>{
  // Registration fixture suites deliberately change this event to interest-only.
  test.skip(Boolean(test.info().config.configFile?.match(/registration|seev|operations/)),'Public migration state only.');
  const catalogue=await (await page.request.get('/api/public/events')).json();
  const event=catalogue.events.find((event:{slug:string})=>event.slug==='sun-chasers-labadi');
  expect(event.startsAt).toBe('2026-10-25T14:00:00.000Z');
  expect(event.scheduleStatus).toBe('confirmed');
  await page.goto('/event/sun-chasers-labadi');
  await expect(page.locator('.event-host')).toContainText('Kofi Bills');
  await expect(page.locator('.event-host')).toContainText('Verified host');
  await expect(page.locator('.event-host')).not.toContainText('Reviewed Host');
  await expect(page.locator('.event-date-display')).toHaveAttribute('datetime','2026-10-25T14:00:00.000Z');
  if(event.registrationOpen){
    await page.getByRole('button',{name:/^(Request an )?RSVP$/}).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
  }else{
    await expect(page.getByText('RSVP opens 12 October, 12 AM GMT. See you here.')).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
  }
  await expect(page.getByRole('link',{name:/Get tickets/})).toHaveCount(0);
  await page.goto('/rsvp/sun-chasers-labadi');
  if(event.registrationOpen)await expect(page.getByLabel('Your name')).toBeVisible();
  else await expect(page.getByRole('heading',{name:'RSVP opens 12 October, 12 AM GMT. See you here.'})).toBeVisible();
  await expect(page.locator('.rsvp-signup__facts')).toContainText('Sunday, 25 October 2026');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:`test-results/october-rsvp-${test.info().project.name}.png`,fullPage:true});
});
