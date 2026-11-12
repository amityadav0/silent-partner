// Keep-online: accounts with no keys of their own (community vaults are created by
// the operator with no access key) can't be refilled by hand, and each NAV post
// spends their NEAR. The season tick refills them from the operator.

export const TOPUP = {
  /** Refill when the account has less than this many days of spend left. */
  belowDays: 3,
  /** NEAR sent per refill (≈ 3.5 days at 0.29 NEAR/day). */
  amount: 1,
  /** Never take the operator below this many free NEAR (≈ 9 days of its own spend). */
  operatorFloor: 3,
};

/** Should `free` NEAR at `perDay` be refilled, given the operator's own free NEAR? */
export function needsTopup(free: number, perDay: number, operatorFree: number): boolean {
  return free / perDay < TOPUP.belowDays && operatorFree - TOPUP.amount >= TOPUP.operatorFloor;
}
