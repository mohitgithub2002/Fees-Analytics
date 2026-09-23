/**
 * Which payments carry a real date, and which only look like they do.
 *
 * Two kinds of transaction exist in this ledger without a genuine payment
 * date behind them:
 *
 *   LEGACY-*   created by the one-time migration from the flat StudentFee
 *              table. Every one carries the timestamp of the migration run,
 *              not the day money changed hands.
 *   OPENING-*  created by the fee import to back an opening balance — an
 *              "already paid" figure a school types in when it has the total
 *              but not the individual receipts.
 *
 * Both are real money and must keep the ledger's invariants (a paid amount
 * with no transaction behind it would break `sum(allocations) = amount`), but
 * neither can be used to say WHEN a family pays. Treating them as dated would
 * stack a school's entire history onto one or two days and manufacture a
 * seasonal pattern out of nothing — so every timing calculation excludes them.
 *
 * Defined here once because the rule is applied in five places, in both
 * TypeScript and SQL, and a prefix added in one and forgotten in another would
 * be invisible until a chart looked subtly wrong.
 */

export const UNDATED_RECEIPT_PREFIXES = ['LEGACY-', 'OPENING-'] as const

/** POSIX regex for the SQL side: `"receiptNo" !~ UNDATED_RECEIPT_REGEX`. */
export const UNDATED_RECEIPT_REGEX = '^(LEGACY|OPENING)-'

export function isUndatedReceipt(receiptNo: string): boolean {
  return UNDATED_RECEIPT_PREFIXES.some((prefix) => receiptNo.startsWith(prefix))
}

/** Receipt number for an opening balance backed by no individual receipt. */
export function openingReceiptNo(feeItemId: number): string {
  return `OPENING-${feeItemId}`
}
