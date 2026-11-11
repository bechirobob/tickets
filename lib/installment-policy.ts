/** Money is always integer pesewas. This module never trusts a browser balance. */
export type InstallmentSummary = {
  totalMinor: number;
  collectedMinor: number;
  balanceMinor: number;
  status: 'unpaid' | 'part_paid' | 'paid';
  roomEligible: boolean;
  admissionEligible: boolean;
};
function money(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid payment amount.');
}
export function installmentSummary(totalMinor: number, collectedMinor: number): InstallmentSummary {
  money(totalMinor); money(collectedMinor);
  if (totalMinor === 0 || collectedMinor > totalMinor) throw new Error('Payment balance needs review.');
  return {
    totalMinor, collectedMinor, balanceMinor: totalMinor - collectedMinor,
    status: collectedMinor === 0 ? 'unpaid' : collectedMinor === totalMinor ? 'paid' : 'part_paid',
    roomEligible: collectedMinor > 0,
    admissionEligible: collectedMinor === totalMinor,
  };
}
/** Fee policy must be resolved into the immutable total BEFORE creating a plan. */
export function nextInstallmentMinor(totalMinor: number, collectedMinor: number, stepMinor: number, choice: 'installment' | 'balance') {
  money(stepMinor);
  if (!stepMinor || !['installment', 'balance'].includes(choice)) throw new Error('Choose a payment option.');
  const { balanceMinor } = installmentSummary(totalMinor, collectedMinor);
  if (!balanceMinor) throw new Error('This booking is already paid.');
  return choice === 'balance' ? balanceMinor : Math.min(stepMinor, balanceMinor);
}
