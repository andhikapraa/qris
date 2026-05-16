import { calculateCRC16 } from "./crc16";
import { parseTLV } from "./parser";
import { validateQRIS } from "./validator";
import { QRISError, type ConvertOptions, type TLV } from "./types";

/** EMVCo TLV length is a 2-digit field — value byte length must be 0..99. */
const MAX_TLV_LENGTH = 99;
/** EMVCo tag 54 (Transaction Amount) max length is 13. */
const MAX_AMOUNT_DIGITS = 13;
/** EMVCo tags 56/57 (convenience fee value) max length is 13. */
const MAX_FEE_DIGITS = 13;

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

/**
 * Format a number as a plain decimal EMVCo numeric value. Rejects non-finite
 * values and exponential notation (e.g. 1e-7, 1e21) which are not valid
 * EMVCo numerics.
 */
function numericString(n: number, label: string, maxDigits: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new QRISError(`${label} must be a finite number (got ${n})`);
  }
  const s = String(n);
  if (/[eE]/.test(s)) {
    throw new QRISError(
      `${label} produces non-decimal notation "${s}"; use a plain decimal value`
    );
  }
  if (s.replace(/[.-]/g, "").length > maxDigits) {
    throw new QRISError(
      `${label} "${s}" exceeds the EMVCo maximum of ${maxDigits} digits`
    );
  }
  return s;
}

type TipSpec =
  | { kind: "prompt" }
  | { kind: "fixed"; value: string }
  | { kind: "percentage"; value: string };

/** Recover the tip/convenience config already present in a (dynamic) source. */
function extractSourceTip(elements: TLV[]): TipSpec | undefined {
  const t55 = elements.find((e) => e.tag === "55")?.value;
  if (!t55) return undefined;
  if (t55 === "01") return { kind: "prompt" };
  if (t55 === "02") {
    const v = elements.find((e) => e.tag === "56")?.value;
    return v == null ? undefined : { kind: "fixed", value: v };
  }
  if (t55 === "03") {
    const v = elements.find((e) => e.tag === "57")?.value;
    return v == null ? undefined : { kind: "percentage", value: v };
  }
  return undefined;
}

/** Emit tip TLVs (tag 55 + 56/57) in EMVCo order for a TipSpec. */
function tipTLVs(tip: TipSpec): TLV[] {
  if (tip.kind === "prompt") {
    return [makeTLV("55", "01", "Tip or Convenience Indicator")];
  }
  if (tip.kind === "fixed") {
    return [
      makeTLV("55", "02", "Tip or Convenience Indicator"),
      makeTLV("56", tip.value, "Value of Convenience Fee (Fixed)"),
    ];
  }
  return [
    makeTLV("55", "03", "Tip or Convenience Indicator"),
    makeTLV("57", tip.value, "Value of Convenience Fee (%)"),
  ];
}

/**
 * Convert a static QRIS string to dynamic by injecting amount and optional fee.
 *
 * - Validates the input (unless `skipValidation`) and the amount.
 * - Flips Point of Initiation Method "11" → "12".
 * - Inserts Transaction Amount (tag 54) before Country Code (tag 58).
 * - If `fee` is given, sets the convenience fee (tags 55 + 56/57). If `fee`
 *   is omitted, any tip/convenience config already in the source is
 *   preserved (re-converting only replaces the amount — non-destructive).
 * - Recomputes the CRC16 over the UTF-8 bytes.
 *
 * Idempotent on already-dynamic codes.
 *
 * @throws {QRISError} on invalid input, a non-positive/non-integer or
 * over-length amount, an unknown fee type, or if the source has no Country
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
  const amountStr = numericString(amount, "amount", MAX_AMOUNT_DIGITS);

  let tip: TipSpec | undefined;
  if (fee) {
    if (fee.type !== "fixed" && fee.type !== "percentage") {
      throw new QRISError(
        `fee.type must be "fixed" or "percentage" (got ${JSON.stringify(fee.type)})`
      );
    }
    if (typeof fee.value !== "number" || !isFinite(fee.value) || fee.value < 0) {
      throw new QRISError(
        `fee.value must be a finite non-negative number (got ${fee.value})`
      );
    }
    if (fee.type === "fixed") {
      if (!Number.isInteger(fee.value)) {
        throw new QRISError(
          `fee.value for a fixed fee must be an integer (got ${fee.value})`
        );
      }
      tip = {
        kind: "fixed",
        value: numericString(fee.value, "fee.value", MAX_FEE_DIGITS),
      };
    } else {
      tip = {
        kind: "percentage",
        value: numericString(fee.value, "fee.value", MAX_FEE_DIGITS),
      };
    }
  }

  if (!skipValidation) {
    const { valid, errors } = validateQRIS(qrisString);
    if (!valid) {
      throw new QRISError(`invalid source QRIS: ${errors.join("; ")}`);
    }
  }

  const elements = parseTLV(qrisString.trim());

  // No explicit fee given → preserve whatever tip/convenience config the
  // source already had (non-destructive re-conversion).
  if (!tip) {
    tip = extractSourceTip(elements);
  }

  // Strip every managed tag; we re-emit 54 (+ tip) in EMVCo order and 63.
  const managedTags = new Set(["54", "55", "56", "57", "63"]);

  const result: TLV[] = [];
  let amountInserted = false;

  for (const el of elements) {
    if (managedTags.has(el.tag)) continue;

    if (el.tag === "01") {
      result.push(makeTLV("01", "12", "Point of Initiation Method"));
      continue;
    }

    if (el.tag === "58" && !amountInserted) {
      result.push(makeTLV("54", amountStr, "Transaction Amount"));
      if (tip) result.push(...tipTLVs(tip));
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
