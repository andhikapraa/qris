import { describe, it, expect } from "vitest";
import {
  calculateCRC16,
  validateQRIS,
  parseQRIS,
  parseTLV,
  convertQRIS,
  QRISError,
} from "../src/index";

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/** Byte-correct TLV element: tag + 2-digit byte length + value. */
function tlv(tag: string, value: string): string {
  return `${tag}${byteLen(value).toString().padStart(2, "0")}${value}`;
}

/** Assemble a structurally valid static QRIS with a correct CRC. */
function makeStaticQRIS(opts?: {
  merchant?: string;
  city?: string;
  method?: string;
  withFee?: "fixed" | "percentage" | "prompt";
}): string {
  const merchant = opts?.merchant ?? "Toko Mamen";
  const city = opts?.city ?? "Bandung";
  const method = opts?.method ?? "11";

  const mai = tlv("00", "ID.CO.QRIS.WWW") + tlv("01", "936000914550000000");
  const additional = tlv("07", "A01");

  let fee = "";
  if (opts?.withFee === "fixed") fee = tlv("55", "02") + tlv("56", "2000");
  else if (opts?.withFee === "percentage")
    fee = tlv("55", "03") + tlv("57", "0.7");
  else if (opts?.withFee === "prompt") fee = tlv("55", "01");

  const body =
    "000201" +
    tlv("01", method) +
    tlv("26", mai) +
    tlv("52", "5945") +
    tlv("53", "360") +
    fee +
    tlv("58", "ID") +
    tlv("59", merchant) +
    tlv("60", city) +
    tlv("61", "10110") +
    tlv("62", additional) +
    "6304";
  return body + calculateCRC16(body);
}

describe("calculateCRC16", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check value", () => {
    expect(calculateCRC16("123456789")).toBe("29B1");
  });

  it("returns a 4-char uppercase hex string", () => {
    expect(calculateCRC16("hello")).toMatch(/^[0-9A-F]{4}$/);
  });

  it("checksums over UTF-8 bytes (multi-byte input is deterministic)", () => {
    const a = calculateCRC16("Café");
    expect(a).toMatch(/^[0-9A-F]{4}$/);
    expect(calculateCRC16("Café")).toBe(a);
    // Differs from the ASCII-only prefix (extra bytes change the CRC).
    expect(calculateCRC16("Caf")).not.toBe(a);
  });
});

describe("validateQRIS", () => {
  it("accepts a well-formed static QRIS", () => {
    expect(validateQRIS(makeStaticQRIS())).toEqual({ valid: true, errors: [] });
  });

  it("accepts a lowercase declared CRC", () => {
    const q = makeStaticQRIS();
    const lower = q.slice(0, -4) + q.slice(-4).toLowerCase();
    expect(validateQRIS(lower).valid).toBe(true);
  });

  it("rejects empty input", () => {
    expect(validateQRIS("").valid).toBe(false);
  });

  it("detects a CRC mismatch", () => {
    const bad = makeStaticQRIS().slice(0, -4) + "0000";
    const r = validateQRIS(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("CRC mismatch"))).toBe(true);
  });

  it("rejects a payload without the EMVCo header", () => {
    expect(validateQRIS("9999" + makeStaticQRIS()).valid).toBe(false);
  });

  it("rejects trailing data after the CRC element (full consumption)", () => {
    const r = validateQRIS(makeStaticQRIS() + "XX");
    expect(r.valid).toBe(false);
    expect(
      r.errors.some(
        (e) => e.includes("trailing data") || e.includes("final element")
      )
    ).toBe(true);
  });

  it("rejects when tag 63 is not the final element", () => {
    // Put a (well-formed) extra tag after a valid CRC tag.
    const base = makeStaticQRIS();
    const inner = base.slice(0, -4); // ...6304
    const tampered =
      inner + calculateCRC16(inner) + tlv("80", "x"); // junk TLV after CRC
    const r = validateQRIS(tampered);
    expect(r.valid).toBe(false);
  });

  it("rejects merchant account info missing sub-tag 00", () => {
    const mai = tlv("01", "936000914550000000"); // no child 00
    const body =
      "000201" +
      tlv("01", "11") +
      tlv("26", mai) +
      tlv("52", "5945") +
      tlv("53", "360") +
      tlv("58", "ID") +
      tlv("59", "Toko") +
      tlv("60", "Kota") +
      tlv("61", "10110") +
      "6304";
    const q = body + calculateCRC16(body);
    const r = validateQRIS(q);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("globally unique"))).toBe(true);
  });

  it("rejects a nested template that does not fully consume", () => {
    // tag 26 declares 10 bytes but the inner TLV only accounts for some.
    const body =
      "000201" + tlv("01", "11") + "2610" + "0002AB" + "ZZZZ" + // malformed inner
      tlv("52", "5945") +
      tlv("53", "360") +
      tlv("58", "ID") +
      tlv("59", "Toko") +
      tlv("60", "Kota") +
      "6304";
    const q = body + calculateCRC16(body);
    expect(validateQRIS(q).valid).toBe(false);
  });
});

describe("parseQRIS", () => {
  it("extracts merchant fields and method", () => {
    const p = parseQRIS(makeStaticQRIS({ merchant: "Warung ABC", city: "Jakarta" }));
    expect(p.method).toBe("static");
    expect(p.merchantName).toBe("Warung ABC");
    expect(p.merchantCity).toBe("Jakarta");
    expect(p.currency).toBe("360");
    expect(p.merchantAccountInfo.length).toBeGreaterThan(0);
    expect(p.merchantAccountInfo[0]?.globallyUniqueId).toBe("ID.CO.QRIS.WWW");
  });

  it("maps method 12 to dynamic", () => {
    expect(parseQRIS(makeStaticQRIS({ method: "12" })).method).toBe("dynamic");
  });

  it("maps an invalid method value to unknown", () => {
    expect(parseQRIS(makeStaticQRIS({ method: "13" })).method).toBe("unknown");
  });

  it("round-trips a multi-byte merchant name via byte lengths", () => {
    const q = makeStaticQRIS({ merchant: "Warung Café Señor" });
    expect(validateQRIS(q).valid).toBe(true);
    expect(parseQRIS(q).merchantName).toBe("Warung Café Señor");
  });
});

describe("convertQRIS", () => {
  const base = makeStaticQRIS();

  it("produces a valid dynamic QRIS with the amount embedded", () => {
    const dyn = convertQRIS(base, { amount: 350135 });
    expect(validateQRIS(dyn)).toEqual({ valid: true, errors: [] });
    const p = parseQRIS(dyn);
    expect(p.method).toBe("dynamic");
    expect(p.amount).toBe("350135");
  });

  it("folds a fixed fee into the amount (no fee tags emitted)", () => {
    const dyn = convertQRIS(base, { amount: 10000, fee: { type: "fixed", value: 2000 } });
    expect(validateQRIS(dyn).valid).toBe(true);
    const p = parseQRIS(dyn);
    expect(p.amount).toBe("12000");
    expect(p.tipIndicator).toBeUndefined();
    expect(p.raw.some((t) => t.tag === "55" || t.tag === "56" || t.tag === "57")).toBe(false);
  });

  it("folds a percentage fee (of the base) into the amount", () => {
    const dyn = convertQRIS(base, { amount: 10000, fee: { type: "percentage", value: 0.7 } });
    expect(parseQRIS(dyn).amount).toBe("10070");
  });

  it("folds a combined fee: base + fixed + round(base × pct / 100)", () => {
    // 10000 + 2000 + 1% of base (100) = 12100  (NOT 1% of 12000)
    const dyn = convertQRIS(base, {
      amount: 10000,
      fee: { type: "combined", value: { fixed: 2000, percentage: 1 } },
    });
    expect(validateQRIS(dyn).valid).toBe(true);
    expect(parseQRIS(dyn).amount).toBe("12100");
  });

  it("rounds the percentage surcharge to whole rupiah", () => {
    // 33333 + round(33333 × 0.5 / 100=166.665) = 33333 + 167 = 33500
    expect(parseQRIS(convertQRIS(base, { amount: 33333, fee: { type: "percentage", value: 0.5 } })).amount).toBe("33500");
  });

  it("is idempotent: re-converting a dynamic QRIS replaces the amount", () => {
    const once = convertQRIS(base, { amount: 350135 });
    const twice = convertQRIS(once, { amount: 999 });
    expect(validateQRIS(twice).valid).toBe(true);
    expect(parseQRIS(twice).amount).toBe("999");
  });

  it("passes a source tip indicator through untouched", () => {
    const src = makeStaticQRIS({ withFee: "prompt" });
    const dyn = convertQRIS(src, { amount: 1000 });
    expect(validateQRIS(dyn).valid).toBe(true);
    expect(parseQRIS(dyn).tipIndicator).toBe("prompt");
  });

  it("rejects a non-positive, non-integer, or over-length amount", () => {
    expect(() => convertQRIS(base, { amount: 0 })).toThrow(QRISError);
    expect(() => convertQRIS(base, { amount: -5 })).toThrow(QRISError);
    expect(() => convertQRIS(base, { amount: 100.5 })).toThrow(QRISError);
    expect(() => convertQRIS(base, { amount: 12345678901234 })).toThrow(QRISError);
  });

  it("rejects an invalid source QRIS", () => {
    expect(() => convertQRIS("not-a-qris", { amount: 1000 })).toThrow(QRISError);
  });

  it("rejects a non-integer fixed fee and an unknown fee type", () => {
    expect(() =>
      convertQRIS(base, { amount: 1000, fee: { type: "fixed", value: 12.5 } })
    ).toThrow(QRISError);
    expect(() =>
      // @ts-expect-error — exercise a JS consumer passing a bad fee.type
      convertQRIS(base, { amount: 1000, fee: { type: "bogus", value: 1 } })
    ).toThrow(QRISError);
  });

  it("rejects invalid combined-fee inputs", () => {
    expect(() =>
      convertQRIS(base, { amount: 1000, fee: { type: "combined", value: { fixed: 1.5, percentage: 1 } } })
    ).toThrow(QRISError);
    expect(() =>
      convertQRIS(base, { amount: 1000, fee: { type: "combined", value: { fixed: 100, percentage: -1 } } })
    ).toThrow(QRISError);
  });

  it("rejects a final amount that exceeds 13 digits", () => {
    expect(() =>
      convertQRIS(base, { amount: 9999999999999, fee: { type: "fixed", value: 9999999999999 } })
    ).toThrow(QRISError);
  });

  it("skipValidation converts a parseable but non-validating code, but still needs tag 58", () => {
    // Minimal parseable code with a Country Code → converts.
    const ok =
      "000201" + tlv("01", "11") + tlv("58", "ID") + "6304";
    const okFull = ok + calculateCRC16(ok);
    expect(parseQRIS(convertQRIS(okFull, { amount: 50, skipValidation: true })).amount).toBe("50");

    // No tag 58 → explicit guard throws even with skipValidation.
    const no58 = "000201" + tlv("01", "11") + "6304";
    const no58Full = no58 + calculateCRC16(no58);
    expect(() =>
      convertQRIS(no58Full, { amount: 50, skipValidation: true })
    ).toThrow(QRISError);
  });

  it("handles a merchant name at the 99-byte EMVCo TLV limit", () => {
    const dyn = convertQRIS(makeStaticQRIS({ merchant: "x".repeat(99) }), {
      amount: 1,
    });
    expect(validateQRIS(dyn).valid).toBe(true);
    expect(parseQRIS(dyn).merchantName).toBe("x".repeat(99));
  });
});

describe("parseTLV", () => {
  it("parses nested templates by byte length", () => {
    const els = parseTLV(makeStaticQRIS());
    const mai = els.find((e) => e.tag === "26");
    expect(mai?.children?.some((c) => c.tag === "00")).toBe(true);
  });
});

