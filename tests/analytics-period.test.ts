import { expect, it } from 'vitest';
import { analyticsPeriod, percentageChange, hostEventEnded } from '../lib/analytics-period';

it('aligns seven-day reports with Accra day buckets across a month boundary', () => {
  expect(analyticsPeriod('7', new Date('2026-10-02T13:45:00Z'))).toEqual({range:'7',start:'2026-09-26T00:00:00.000Z',previousStart:'2026-09-19T00:00:00.000Z',previousEnd:'2026-09-26T00:00:00.000Z'});
});
it('does not invent a percentage increase from no previous activity', () => {
  expect(percentageChange(8,0)).toBeNull();expect(percentageChange(0,0)).toBe(0);
  expect(percentageChange(5,10)).toBe(-50);expect(percentageChange(20,10)).toBe(100);
});
it('keeps coming-soon and postponed setup usable despite an old provisional end date', () => {
  const event={scheduleStatus:'coming_soon',eventState:'on_sale',endsAt:'2020-01-01T00:00:00Z'};
  expect(hostEventEnded(event,Date.now())).toBe(false);
  expect(hostEventEnded({...event,scheduleStatus:'confirmed',eventState:'postponed'},Date.now())).toBe(false);
  expect(hostEventEnded({...event,scheduleStatus:'confirmed'},Date.now())).toBe(true);
  expect(hostEventEnded({...event,eventState:'past'},Date.now())).toBe(true);
});
