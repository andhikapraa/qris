import { calculateCRC16 } from "./crc16";
import { parseTLV } from "./parser";
import { validateQRIS } from "./validator";
import { QRISError, type ConvertOptions, type Fee, type TLV } from "./types";

/** EMVCo TLV length is a 2-digit field — value byte length must be 0..99. */
const MAX_TLV_LENGTH = 99;
/** EMVCo tag 54 (Transaction Amount) max length is 13. */
const MAX_AMOUNT_DIGITS = 13;

const _encoder = new TextEncoder();

/** Byte length of a string (EMVCo TLV length fields count bytes). */
function byteLength(str: string): number {
  return _encoder.encode(str).length;
}

/** Rebuild a QRIS string from TLV elements (without CRC). */
function buildTLVString(elements: TLV[]): string {
  let out = "";
  for (const el of elements) {
    const value = el.children ? buildTLVString(el.children) : el.value;
    const len = byteLength(value);
    if (len > MAX_TLV_LENGTH) {
      throw new QRISError(
        `TLV value for tag ${el.tag} is ${len} bytes; EMVCo allows at most ${MAX_TLV_LENGTH}`
      );
    }
    out += `${el.tag}${len.toString().padStart(2, "0")}${value}`;
  }
  return out;
}

/** Create a TLV element. */
function makeTLV(tag: string, value: string, name = ""): TLV {
  return { tag, name, length: byteLength(value), value };
}

function assertNonNegInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new QRISError(`${label} must be a non-negative integer (got ${n})`);
  }
}

function assertNonNegFinite(n: number, label: string): void {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new QRISError(
      `${label} must be a non-negative finite number (got ${n})`
    );
  }
}

/**
 * Fold the optional fee into the base amount:
 *   total = base + fixed + round(base × percentage / 100)
 * The percentage applies to the base only. Returns an integer rupiah total.
 */
function applyFee(base: number, fee?: Fee): number {
  if (!fee) return base;

  if (fee.type === "fixed") {
    assertNonNegInt(fee.value, "fee.value");
    return base + fee.value;
  }
  if (fee.type === "percentage") {
    assertNonNegFinite(fee.value, "fee.value");
    return base + Math.round((base * fee.value) / 100);
  }
  if (fee.type === "combined") {
    assertNonNegInt(fee.value?.fixed, "fee.value.fixed");
    assertNonNegFinite(fee.value?.percentage, "fee.value.percentage");
    return base + fee.value.fixed + Math.round((base * fee.value.percentage) / 100);
  }
  throw new QRISError(
    `fee.type must be "fixed", "percentage", or "combined" (got ${JSON.stringify((fee as { type?: unknown }).type)})`
  );
}

/**
 * Convert a static QRIS string to dynamic by setting the transaction amount.
 *
 * - Validates the input (unless `skipValidation`) and the amount.
 * - Flips Point of Initiation Method "11" → "12".
 * - Folds any `fee` into the amount and writes it as tag 54 before the
 *   Country Code (tag 58). No EMVCo fee tags are emitted.
 * - Recomputes the CRC16 over the UTF-8 bytes.
 *
 * Idempotent on already-dynamic codes (re-converting just replaces the
 * amount). Any tip/convenience tags already in the source pass through
 * untouched.
 *
 * @throws {QRISError} on invalid input, an invalid base/fee, a final amount
 * that is not a positive integer ≤ 13 digits, or a source with no Country
 * Code (tag 58) to anchor the amount before.
 */
export function convertQRIS(
  qrisString: string,
  options: ConvertOptions
): string {
  const { amount, fee, skipValidation = false } = options;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new QRISError(
      `amount must be a positive integer (got ${amount}); QRIS IDR amounts have no decimals`
    );
  }

  const total = applyFee(amount, fee);
  if (!Number.isInteger(total) || total <= 0) {
    throw new QRISError(
      `final amount must be a positive integer (got ${total})`
    );
  }
  const totalStr = String(total);
  if (totalStr.length > MAX_AMOUNT_DIGITS) {
    throw new QRISError(
      `final amount ${totalStr} exceeds the EMVCo maximum of ${MAX_AMOUNT_DIGITS} digits`
    );
  }

  if (!skipValidation) {
    const { valid, errors } = validateQRIS(qrisString);
    if (!valid) {
      throw new QRISError(`invalid source QRIS: ${errors.join("; ")}`);
    }
  }

  const elements = parseTLV(qrisString.trim());

  // We own tag 54 (amount) and 63 (CRC); everything else passes through.
  const managedTags = new Set(["54", "63"]);

  const result: TLV[] = [];
  let amountInserted = false;

  for (const el of elements) {
    if (managedTags.has(el.tag)) continue;

    if (el.tag === "01") {
      result.push(makeTLV("01", "12", "Point of Initiation Method"));
      continue;
    }

    if (el.tag === "58" && !amountInserted) {
      result.push(makeTLV("54", totalStr, "Transaction Amount"));
      amountInserted = true;
    }

    result.push(el);
  }

  if (!amountInserted) {
    throw new QRISError(
      "could not insert Transaction Amount: source QRIS has no Country Code (tag 58)"
    );
  }

  const crcInput = `${buildTLVString(result)}6304`;
  return crcInput + calculateCRC16(crcInput);
}
