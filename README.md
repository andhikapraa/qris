# @prasetya/qris

Zero-dependency QRIS toolkit for Indonesian EMVCo payment codes: **parse**,
**validate**, and convert **static → dynamic** (inject amount + optional
convenience fee, recompute the CRC). Ships dual ESM + CJS with TypeScript types.

## Install

```bash
npm install @prasetya/qris
```

## Usage

```ts
import { convertQRIS, computeTotal, parseQRIS, validateQRIS } from "@prasetya/qris";

const staticCode = "0002010102112657...6304ABCD"; // merchant's static QRIS

const { valid, errors } = validateQRIS(staticCode);
if (!valid) throw new Error(errors.join("; "));

// Static → dynamic for a Rp 350.135 charge
const dynamic = convertQRIS(staticCode, { amount: 350135 });

// With a fixed Rp 2.000 convenience fee
convertQRIS(staticCode, { amount: 10000, fee: { type: "fixed", value: 2000 } });

// With a 0.7% convenience fee
convertQRIS(staticCode, { amount: 10000, fee: { type: "percentage", value: 0.7 } });

// Combined fixed + percentage: EMVCo has no indicator for both, so fold it
// into the amount. computeTotal = base + fixed + round(base × pct / 100).
const total = computeTotal(10000, { fixed: 2000, percentage: 1 }); // 12100
convertQRIS(staticCode, { amount: total });

parseQRIS(dynamic).amount; // "350135"
```

`convertQRIS` validates the input and the amount by default and throws
`QRISError` on bad data. Pass `{ skipValidation: true }` to skip the input
check. `amount` must be a positive integer (IDR has no decimals).

## API

| Export | Description |
| --- | --- |
| `convertQRIS(qris, { amount, fee?, skipValidation? })` | Static → dynamic; recomputes CRC. Idempotent on already-dynamic codes. If `fee` is omitted, any tip/convenience config in the source is preserved. |
| `computeTotal(base, { fixed?, percentage? })` | Integer total = `base + fixed + round(base × percentage / 100)` (percentage on base only). For combined fees, which EMVCo can't express in tag 55; pass the result as `amount`. |
| `parseQRIS(qris)` | Structured `QRISData`. `method` is `"static"` \| `"dynamic"` \| `"unknown"`. |
| `validateQRIS(qris)` | `{ valid, errors[] }` — header, strict TLV consumption, terminal CRC element, checksum, required tags, merchant GUI. |
| `parseTLV(str)` | Raw recursive TLV element tree (lenient). |
| `calculateCRC16(str)` | CRC-16/CCITT-FALSE over UTF-8 bytes, 4-char uppercase hex. |
| `QRISError` | Thrown by `convertQRIS` on invalid input. |

## CLI

```bash
# Interactive
npx @prasetya/qris

# Non-interactive (scriptable; exit 1 + stderr on error)
npx @prasetya/qris <staticQris> <amount> [fixed|percentage <feeValue>]
npx @prasetya/qris 00020101...6304ABCD 350135
npx @prasetya/qris 00020101...6304ABCD 10000 percentage 0.7
```

## Notes

- TLV parsing, serialization, and CRC all operate on **UTF-8 bytes**, so
  non-ASCII merchant data round-trips correctly and checksums consistently.
- EMVCo TLV length fields are byte-counted (max 99); `amount` is a positive
  integer ≤ 13 digits (IDR has no decimals); fee values reject exponential
  notation. Violations throw `QRISError`.

## License

MIT — derived from [verssache/qris-dinamis](https://github.com/verssache/qris-dinamis).
