import type { TLV, QRISData, MerchantAccountInfo } from "./types";

/** Map of known EMVCo / QRIS tag IDs to human-readable names */
const TAG_NAMES: Record<string, string> = {
  "00": "Payload Format Indicator",
  "01": "Point of Initiation Method",
  "02": "Visa",
  "03": "Visa",
  "04": "Mastercard",
  "05": "Mastercard",
  "06": "EMVCo",
  "07": "EMVCo",
  "08": "EMVCo",
  "09": "Discover",
  "10": "Discover",
  "11": "Amex",
  "12": "Amex",
  "13": "JCB",
  "14": "JCB",
  "15": "UnionPay",
  "16": "UnionPay",
  "17": "EMVCo",
  "26": "Merchant Account Information",
  "27": "Merchant Account Information",
  "28": "Merchant Account Information",
  "29": "Merchant Account Information",
  "30": "Merchant Account Information",
  "31": "Merchant Account Information",
  "32": "Merchant Account Information",
  "33": "Merchant Account Information",
  "34": "Merchant Account Information",
  "35": "Merchant Account Information",
  "36": "Merchant Account Information",
  "37": "Merchant Account Information",
  "38": "Merchant Account Information",
  "39": "Merchant Account Information",
  "40": "Merchant Account Information",
  "41": "Merchant Account Information",
  "42": "Merchant Account Information",
  "43": "Merchant Account Information",
  "44": "Merchant Account Information",
  "45": "Merchant Account Information",
  "46": "Merchant Account Information",
  "47": "Merchant Account Information",
  "48": "Merchant Account Information",
  "49": "Merchant Account Information",
  "50": "Merchant Account Information",
  "51": "Merchant Account Information",
  "52": "Merchant Category Code",
  "53": "Transaction Currency",
  "54": "Transaction Amount",
  "55": "Tip or Convenience Indicator",
  "56": "Value of Convenience Fee (Fixed)",
  "57": "Value of Convenience Fee (%)",
  "58": "Country Code",
  "59": "Merchant Name",
  "60": "Merchant City",
  "61": "Postal Code",
  "62": "Additional Data Field",
  "63": "CRC",
};

/** Tags whose value is itself a nested TLV template (26-51 and 62) */
const NESTED_TAGS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String(i + 26).padStart(2, "0")),
  "62",
]);

const _encoder = new TextEncoder();
const _decoder = new TextDecoder("utf-8", { fatal: false });

const ASCII_0 = 0x30;
const ASCII_9 = 0x39;

/** Read two ASCII digit bytes as an integer, or null if not both digits. */
function readDigits2(bytes: Uint8Array, pos: number): number | null {
  if (pos + 2 > bytes.length) return null;
  const d0 = bytes[pos] as number;
  const d1 = bytes[pos + 1] as number;
  if (d0 < ASCII_0 || d0 > ASCII_9 || d1 < ASCII_0 || d1 > ASCII_9) return null;
  return (d0 - ASCII_0) * 10 + (d1 - ASCII_0);
}

interface Region {
  elements: TLV[];
  /** Bytes consumed at this level before a clean stop or malformed halt. */
  consumed: number;
}

/**
 * Parse a region of UTF-8 bytes into TLV elements. Lenient: stops at the
 * first malformed element at this level. Structural problems (truncation,
 * non-numeric length, value overrun, nested template not fully consumed)
 * are appended to `problems` when provided, without aborting ancestors.
 */
function parseRegion(bytes: Uint8Array, problems?: string[]): Region {
  const elements: TLV[] = [];
  let pos = 0;

  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) {
      problems?.push(`truncated tag/length header at byte ${pos}`);
      return { elements, consumed: pos };
    }

    const tag = _decoder.decode(bytes.subarray(pos, pos + 2));
    const length = readDigits2(bytes, pos + 2);
    if (length === null) {
      problems?.push(`non-numeric length for tag ${tag} at byte ${pos + 2}`);
      return { elements, consumed: pos };
    }

    const valStart = pos + 4;
    const valEnd = valStart + length;
    if (valEnd > bytes.length) {
      problems?.push(
        `value for tag ${tag} overruns payload (needs ${length} bytes)`
      );
      return { elements, consumed: pos };
    }

    const valueBytes = bytes.subarray(valStart, valEnd);
    const element: TLV = {
      tag,
      name: TAG_NAMES[tag] ?? `Unknown (${tag})`,
      length,
      value: _decoder.decode(valueBytes),
    };

    if (NESTED_TAGS.has(tag)) {
      const sub = parseRegion(valueBytes, problems);
      element.children = sub.elements;
      if (sub.consumed !== valueBytes.length) {
        problems?.push(
          `nested template ${tag} not fully consumed (${sub.consumed}/${valueBytes.length} bytes)`
        );
      }
    }

    elements.push(element);
    pos = valEnd;
  }

  return { elements, consumed: pos };
}

/**
 * Parse a raw TLV string into an array of TLV elements.
 * Lenient: stops gracefully on malformed/truncated input.
 */
export function parseTLV(data: string): TLV[] {
  return parseRegion(_encoder.encode(data)).elements;
}

/**
 * Strict parse for validation: reports every structural problem and whether
 * the whole payload was consumed. Internal — not part of the public API.
 */
export function parseStrict(data: string): {
  elements: TLV[];
  problems: string[];
} {
  const bytes = _encoder.encode(data);
  const problems: string[] = [];
  const { elements, consumed } = parseRegion(bytes, problems);
  if (consumed !== bytes.length) {
    problems.push(`unparsed trailing data after byte ${consumed}`);
  }
  return { elements, problems };
}

/**
 * Parse a QRIS string into a structured QRISData object.
 */
export function parseQRIS(qrisString: string): QRISData {
  const raw = parseTLV(qrisString);

  const findTag = (tag: string) => raw.find((t) => t.tag === tag);

  const methodValue = findTag("01")?.value;
  let method: QRISData["method"];
  if (methodValue === "11") method = "static";
  else if (methodValue === "12") method = "dynamic";
  else method = "unknown";

  const tipIndicatorValue = findTag("55")?.value;
  let tipIndicator: QRISData["tipIndicator"];
  if (tipIndicatorValue === "01") tipIndicator = "prompt";
  else if (tipIndicatorValue === "02") tipIndicator = "fixed";
  else if (tipIndicatorValue === "03") tipIndicator = "percentage";

  const merchantAccountInfo: MerchantAccountInfo[] = raw
    .filter((t) => {
      const tagNum = parseInt(t.tag, 10);
      return tagNum >= 26 && tagNum <= 51 && t.children;
    })
    .map((t) => {
      const children = t.children ?? [];
      const findChild = (childTag: string) =>
        children.find((c) => c.tag === childTag);

      return {
        tag: t.tag,
        globallyUniqueId: findChild("00")?.value ?? "",
        merchantId: findChild("01")?.value ?? findChild("02")?.value,
        merchantCriteria: findChild("03")?.value,
        fields: children,
      };
    });

  return {
    version: findTag("00")?.value ?? "01",
    method,
    merchantAccountInfo,
    merchantCategoryCode: findTag("52")?.value ?? "",
    currency: findTag("53")?.value ?? "360",
    amount: findTag("54")?.value,
    tipIndicator,
    tipFixed: findTag("56")?.value,
    tipPercentage: findTag("57")?.value,
    countryCode: findTag("58")?.value ?? "ID",
    merchantName: findTag("59")?.value ?? "",
    merchantCity: findTag("60")?.value ?? "",
    postalCode: findTag("61")?.value ?? "",
    additionalData: findTag("62")?.children,
    crc: findTag("63")?.value ?? "",
    raw,
  };
}
