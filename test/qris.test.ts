import { describe, it, expect } from "vitest";
import {
  calculateCRC16,
  validateQRIS,
  parseQRIS,
  convertQRIS,
  QRISError,
} from "../src/index";

/** Assemble a structurally valid static QRIS with a correct CRC. */
function makeStaticQRIS(merchant = "Toko Mamen", city = "Bandung"): string {
  const body =
    "000201" + // Payload Format Indicator
    "010211" + // Point of Initiation Method = static
    "26570011ID.DANA.WWW011893600915000000000002091000000000303UMI" +
    "51440014ID.CO.QRIS.WWW0215ID10200000000000303UMI" +
    "520459455303360" + // MCC + currency
    "5802ID" +
    `59${merchant.length.toString().padStart(2, "0")}${merchant}` +
    `60${city.length.toString().padStart(2, "0")}${city}` +
    "61054011162070703A01" +
    "6304";
  return body + calculateCRC16(body);
}

describe("calculateCRC16", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check value", () => {
    // Standard reference: "123456789" => 0x29B1
    expect(calculateCRC16("123456789")).toBe("29B1");
  });

  it("returns a 4-char uppercase hex string", () => {
    expect(calculateCRC16("hello")).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("validateQRIS", () => {
  it("accepts a well-formed static QRIS", () => {
    expect(validateQRIS(makeStaticQRIS())).toEqual({ valid: true, errors: [] });
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
});

describe("parseQRIS", () => {
  it("extracts merchant fields and method", () => {
    const p = parseQRIS(makeStaticQRIS("Warung ABC", "Jakarta"));
    expect(p.method).toBe("static");
    expect(p.merchantName).toBe("Warung ABC");
    expect(p.merchantCity).toBe("Jakarta");
    expect(p.currency).toBe("360");
    expect(p.merchantAccountInfo.length).toBeGreaterThan(0);
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

  it("embeds a fixed convenience fee (tags 55=02, 56)", () => {
    const dyn = convertQRIS(base, { amount: 10000, fee: { type: "fixed", value: 2000 } });
    expect(validateQRIS(dyn).valid).toBe(true);
    const p = parseQRIS(dyn);
    expect(p.tipIndicator).toBe("fixed");
    expect(p.tipFixed).toBe("2000");
  });

  it("embeds a percentage convenience fee (tags 55=03, 57)", () => {
    const dyn = convertQRIS(base, { amount: 10000, fee: { type: "percentage", value: 0.7 } });
    expect(validateQRIS(dyn).valid).toBe(true);
    const p = parseQRIS(dyn);
    expect(p.tipIndicator).toBe("percentage");
    expect(p.tipPercentage).toBe("0.7");
  });

  it("is idempotent: re-converting a dynamic QRIS just replaces the amount", () => {
    const once = convertQRIS(base, { amount: 350135 });
    const twice = convertQRIS(once, { amount: 999 });
    expect(validateQRIS(twice).valid).toBe(true);
    expect(parseQRIS(twice).amount).toBe("999");
  });

  it("rejects a non-positive or non-integer amount", () => {
    expect(() => convertQRIS(base, { amount: 0 })).toThrow(QRISError);
    expect(() => convertQRIS(base, { amount: -5 })).toThrow(QRISError);
    expect(() => convertQRIS(base, { amount: 100.5 })).toThrow(QRISError);
  });

  it("rejects an invalid source QRIS", () => {
    expect(() => convertQRIS("not-a-qris", { amount: 1000 })).toThrow(QRISError);
  });

  it("rejects a non-integer fixed fee", () => {
    expect(() =>
      convertQRIS(base, { amount: 1000, fee: { type: "fixed", value: 12.5 } })
    ).toThrow(QRISError);
  });
});
