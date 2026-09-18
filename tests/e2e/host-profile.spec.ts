import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Kofi Bills profile shows the portrait, public socials and linked event',async({page})=>{
  await page.goto('/hosts');
  await page.getByRole('link',{name:'View Host',exact:true}).click();
  await expect(page).toHaveURL(/\/hosts\/kofi-bills$/);
  await expect(page.getByRole('heading',{name:'Kofi Bills',exact:true})).toBeVisible();
  await expect(page.getByText('Henry Yorke',{exact:true})).toBeVisible();
  await expect(page.locator('.host-profile__portrait img')).toBeVisible();
  expect(await page.locator('.host-profile__portrait img').evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  await expect(page.getByRole('link',{name:/Instagram/})).toHaveAttribute('href','https://www.instagram.com/mr.yorke/');
  await expect(page.getByRole('link',{name:/Snapchat/})).toHaveAttribute('href','https://www.snapchat.com/add/kofi_billz123');
  await expect(page.getByRole('heading',{name:'On The Guest List',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({page}).include('.host-profile').analyze()).violations).toEqual([]);
  await page.screenshot({path:`test-results/kofi-bills-${test.info().project.name}.png`,fullPage:true});
});

test('October RSVP is available without a fabricated date or paid checkout',async({page})=>{
  // Registration fixture suites deliberately change this event to interest-only.
  test.skip(Boolean(test.info().config.configFile?.match(/registration|seev|operations/)),'Public migration state only.');
  await page.goto('/event/sun-chasers-labadi');
  await expect(page.getByRole('heading',{name:'October · Coming soon',exact:true})).toBeVisible();
  await expect(page.getByText('Limited RSVP spots. Get your name in early.')).toBeVisible();
  await page.getByRole('button',{name:/^(Request an )?RSVP$/}).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByRole('link',{name:/Get tickets/})).toHaveCount(0);
  await page.goto('/rsvp/sun-chasers-labadi');
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByText('October · Coming soon',{exact:true})).toBeVisible();
  await expect(page.getByText('Limited RSVP spots. Get your name in early.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:`test-results/october-rsvp-${test.info().project.name}.png`,fullPage:true});
});
