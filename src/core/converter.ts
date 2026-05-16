import { calculateCRC16 } from "./crc16";
import { parseTLV } from "./parser";
import { validateQRIS } from "./validator";
import { QRISError, type ConvertOptions, type TLV } from "./types";

/** EMVCo TLV length is a 2-digit field — value byte length must be 0..99. */
const MAX_TLV_LENGTH = 99;

/**
 * Byte length of a string. EMVCo TLV length fields count bytes, not UTF-16
 * code units. Real-world QRIS payloads are ASCII (so this equals
 * `str.length`), but encoding correctly keeps non-ASCII merchant data safe.
 */
function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/** Rebuild a QRIS string from TLV elements (without CRC). */
function buildTLVString(elements: TLV[]): string {
  return elements
    .map((el) => {
      const value = el.children ? buildTLVString(el.children) : el.value;
      const len = byteLength(value);
      if (len > MAX_TLV_LENGTH) {
        throw new QRISError(
          `TLV value for tag ${el.tag} is ${len} bytes; EMVCo allows at most ${MAX_TLV_LENGTH}`
        );
      }
      const length = len.toString().padStart(2, "0");
      return `${el.tag}${length}${value}`;
    })
    .join("");
}

/** Create a TLV element. */
function makeTLV(tag: string, value: string, name = ""): TLV {
  return { tag, name, length: byteLength(value), value };
}

/**
 * Convert a static QRIS string to dynamic by injecting amount and optional fee.
 *
 * Steps:
 * 1. Validate the input (unless `skipValidation`)
 * 2. Parse the TLV structure
 * 3. Change Point of Initiation Method from "11" (static) to "12" (dynamic)
 * 4. Insert/replace Transaction Amount (tag 54)
 * 5. Optionally insert Tip Indicator (tag 55) and fee value (tag 56/57)
 * 6. Recalculate the CRC16 checksum
 *
 * @throws {QRISError} if the input is invalid or the amount is not a positive integer.
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
  if (fee) {
    if (typeof fee.value !== "number" || !isFinite(fee.value) || fee.value < 0) {
      throw new QRISError(`fee.value must be a finite non-negative number (got ${fee.value})`);
    }
    if (fee.type === "fixed" && !Number.isInteger(fee.value)) {
      throw new QRISError(`fee.value for a fixed fee must be an integer (got ${fee.value})`);
    }
  }

  if (!skipValidation) {
    const { valid, errors } = validateQRIS(qrisString);
    if (!valid) {
      throw new QRISError(`invalid source QRIS: ${errors.join("; ")}`);
    }
  }

  const elements = parseTLV(qrisString.trim());

  // Rebuild TLV preserving order, injecting/replacing managed tags.
  const result: TLV[] = [];
  let amountInserted = false;

  const managedTags = new Set(["54", "55", "56", "57", "63"]);

  for (const el of elements) {
    if (managedTags.has(el.tag)) continue;

    if (el.tag === "01") {
      // Change static → dynamic
      result.push(makeTLV("01", "12", "Point of Initiation Method"));
      continue;
    }

    // Insert amount + fee before tag 58 (Country Code)
    if (el.tag === "58" && !amountInserted) {
      result.push(makeTLV("54", amount.toString(), "Transaction Amount"));

      if (fee) {
        if (fee.type === "fixed") {
          result.push(makeTLV("55", "02", "Tip or Convenience Indicator"));
          result.push(
            makeTLV("56", fee.value.toString(), "Value of Convenience Fee (Fixed)")
          );
        } else {
          result.push(makeTLV("55", "03", "Tip or Convenience Indicator"));
          result.push(
            makeTLV("57", fee.value.toString(), "Value of Convenience Fee (%)")
          );
        }
      }

      amountInserted = true;
    }

    result.push(el);
  }

  // Build string without CRC, then append the recalculated CRC.
  const crcInput = buildTLVString(result) + "6304";
  return crcInput + calculateCRC16(crcInput);
}
