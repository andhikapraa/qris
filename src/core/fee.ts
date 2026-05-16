import { QRISError } from "./types";

/** EMVCo tag 54 (Transaction Amount) max length is 13. */
const MAX_AMOUNT_DIGITS = 13;

export interface FeeBreakdown {
  /** Flat fee added on top of the base, integer IDR (default 0). */
  fixed?: number;
  /** Percentage of the base added on top, e.g. 0.7 = 0.7% (default 0). */
  percentage?: number;
}

/**
 * Compute the integer transaction total for a base price plus an optional
 * flat fee and/or percentage surcharge:
 *
 *   total = base + fixed + round(base × percentage / 100)
 *
 * The percentage applies to the **base only** (not the fixed fee) and the
 * surcharge is rounded to the nearest whole rupiah (IDR has no decimals).
 *
 * EMVCo has no Tip/Convenience indicator for a *combined* fixed+percentage
 * fee (tag 55 is single-valued: 01 prompt / 02 fixed / 03 percentage), so the
 * only spec-correct place for a combined fee is the transaction amount.
 * Pass the result straight to `convertQRIS(static, { amount })`.
 *
 * @throws {QRISError} on a non-integer/negative base or fixed fee, a
 * negative/non-finite percentage, or a total that is not a positive integer
 * of at most 13 digits.
 */
export function computeTotal(base: number, fee?: FeeBreakdown): number {
  if (!Number.isInteger(base) || base < 0) {
    throw new QRISError(`base must be a non-negative integer (got ${base})`);
  }

  const fixed = fee?.fixed ?? 0;
  if (!Number.isInteger(fixed) || fixed < 0) {
    throw new QRISError(
      `fee.fixed must be a non-negative integer (got ${fixed})`
    );
  }

  const percentage = fee?.percentage ?? 0;
  if (
    typeof percentage !== "number" ||
    !Number.isFinite(percentage) ||
    percentage < 0
  ) {
    throw new QRISError(
      `fee.percentage must be a non-negative finite number (got ${percentage})`
    );
  }

  const surcharge = Math.round((base * percentage) / 100);
  const total = base + fixed + surcharge;

  if (!Number.isInteger(total) || total <= 0) {
    throw new QRISError(
      `computed total must be a positive integer (got ${total})`
    );
  }
  if (String(total).length > MAX_AMOUNT_DIGITS) {
    throw new QRISError(
      `computed total ${total} exceeds the EMVCo maximum of ${MAX_AMOUNT_DIGITS} digits`
    );
  }

  return total;
}
