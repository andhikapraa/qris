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
import { convertQRIS, parseQRIS, validateQRIS } from "@prasetya/qris";

const staticCode = "0002010102112657...6304ABCD"; // merchant's static QRIS

const { valid, errors } = validateQRIS(staticCode);
if (!valid) throw new Error(errors.join("; "));

// Static → dynamic for a Rp 350.135 charge
const dynamic = convertQRIS(staticCode, { amount: 350135 });

// Optional fee, one consistent { type, value } shape — folded into the amount:
convertQRIS(staticCode, { amount: 10000, fee: { type: "fixed", value: 2000 } });      // → 12000
convertQRIS(staticCode, { amount: 10000, fee: { type: "percentage", value: 0.7 } });  // → 10070
convertQRIS(staticCode, {
  amount: 10000,
  fee: { type: "combined", value: { fixed: 2000, percentage: 1 } },                   // → 12100
});

parseQRIS(dynamic).amount; // "350135"
```

`amount` is the **base** (positive integer; IDR has no decimals). The optional
`fee` is folded in: `final = base + fixed + round(base × percentage / 100)`
(percentage on the base only). No EMVCo fee tags are emitted — tag 55 is
single-valued and inconsistently honored, so the payer scans one all-in
total. `convertQRIS` validates the input and amount by default and throws
`QRISError` on bad data; pass `{ skipValidation: true }` to skip the input
check.

## API

| Export | Description |
| --- | --- |
| `convertQRIS(qris, { amount, fee?, skipValidation? })` | Static → dynamic; recomputes CRC. `fee` is `{ type: "fixed" \| "percentage" \| "combined", value }` folded into the amount. Idempotent; source tip tags pass through. |
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
