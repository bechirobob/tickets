import { describe, expect, it } from 'vitest';
import { installmentSummary, nextInstallmentMinor } from '../lib/installment-policy';
describe('installment eligibility',()=>{
 it('unlocks Room, never admission, after first payment',()=>{
  expect(installmentSummary(320000,100000)).toMatchObject({status:'part_paid',balanceMinor:220000,roomEligible:true,admissionEligible:false});
  expect(installmentSummary(320000,0).roomEligible).toBe(false);
  expect(installmentSummary(320000,320000).admissionEligible).toBe(true);
 });
 it('supports steps, final remainder, and clearing balance',()=>{
  expect(nextInstallmentMinor(320000,0,100000,'installment')).toBe(100000);
  expect(nextInstallmentMinor(320000,300000,100000,'installment')).toBe(20000);
  expect(nextInstallmentMinor(320000,100000,100000,'balance')).toBe(220000);
 });
 it('rejects invalid money, overpayment and settled bookings',()=>{
  for(const amount of [-1,NaN,Infinity,0.1,Number.MAX_SAFE_INTEGER+1,320001]) expect(()=>installmentSummary(320000,amount)).toThrow();
  expect(()=>nextInstallmentMinor(320000,320000,100000,'balance')).toThrow();
 });
});
