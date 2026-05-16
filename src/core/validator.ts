import { calculateCRC16 } from "./crc16";
import { parseStrict } from "./parser";
import type { ValidationResult } from "./types";

const CRC_HEX = /^[0-9A-Fa-f]{4}$/;

/**
 * Validate a QRIS string for structural correctness: header, strict TLV
 * consumption, a terminal CRC element (tag 63), the CRC checksum itself,
 * required tags, the Point of Initiation Method value, and that every
 * Merchant Account Information template carries a globally unique id.
 */
export function validateQRIS(qrisString: string): ValidationResult {
  const errors: string[] = [];

  if (!qrisString || qrisString.trim().length === 0) {
    return { valid: false, errors: ["QRIS string is empty"] };
  }

  const str = qrisString.trim();

  if (!str.startsWith("000201")) {
    errors.push('QRIS must start with Payload Format Indicator "000201"');
  }

  if (str.length < 20) {
    errors.push("QRIS string is too short");
    return { valid: false, errors };
  }

  const { elements, problems } = parseStrict(str);
  for (const p of problems) {
    errors.push(`Malformed TLV: ${p}`);
  }

  if (elements.length === 0) {
    errors.push("Failed to parse any TLV elements");
    return { valid: false, errors };
  }

  // CRC (tag 63) must be the final element: length 04, 4 hex chars, nothing
  // after it. Only then is "last 4 chars = declared CRC" a safe assumption.
  const last = elements[elements.length - 1] as (typeof elements)[number];
  if (last.tag !== "63") {
    errors.push(
      `CRC (tag 63) must be the final element; last element is tag ${last.tag}`
    );
  } else if (last.length !== 4 || !CRC_HEX.test(last.value)) {
    errors.push(
      `CRC value must be exactly 4 hex characters, got "${last.value}"`
    );
  } else if (problems.length === 0) {
    // Strict parse confirmed full consumption ending at this 6304XXXX tag,
    // so the trailing 4 chars are the declared CRC and the rest is the input.
    const declaredCRC = str.slice(-4);
    const calculatedCRC = calculateCRC16(str.slice(0, -4));
    if (declaredCRC.toUpperCase() !== calculatedCRC) {
      errors.push(
        `CRC mismatch: expected ${calculatedCRC}, got ${declaredCRC.toUpperCase()}`
      );
    }
  }

  const tags = new Set(elements.map((e) => e.tag));

  const requiredTags = [
    { tag: "00", name: "Payload Format Indicator" },
    { tag: "01", name: "Point of Initiation Method" },
    { tag: "52", name: "Merchant Category Code" },
    { tag: "53", name: "Transaction Currency" },
    { tag: "58", name: "Country Code" },
    { tag: "59", name: "Merchant Name" },
    { tag: "60", name: "Merchant City" },
    { tag: "63", name: "CRC" },
  ];

  for (const req of requiredTags) {
    if (!tags.has(req.tag)) {
      errors.push(`Missing required tag ${req.tag} (${req.name})`);
    }
  }

  const method = elements.find((e) => e.tag === "01");
  if (method && method.value !== "11" && method.value !== "12") {
    errors.push(
      `Invalid Point of Initiation Method: "${method.value}" (must be "11" or "12")`
    );
  }

  // Merchant Account Information (tags 26-51): at least one, and each must
  // carry a globally unique identifier in sub-tag 00.
  const merchantEls = elements.filter((e) => {
    const n = parseInt(e.tag, 10);
    return n >= 26 && n <= 51;
  });
  if (merchantEls.length === 0) {
    errors.push("No Merchant Account Information found (tags 26-51)");
  }
  for (const m of merchantEls) {
    const hasGui = m.children?.some(
      (c) => c.tag === "00" && c.value.length > 0
    );
    if (!hasGui) {
      errors.push(
        `Merchant Account Information (tag ${m.tag}) missing globally unique identifier (sub-tag 00)`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
