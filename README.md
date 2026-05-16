# @andhikapraa/qris

Zero-dependency QRIS toolkit for Indonesian EMVCo payment codes: **parse**,
**validate**, and convert **static → dynamic** (inject amount + optional
convenience fee, recompute the CRC). Ships dual ESM + CJS with TypeScript types.

## Install

```bash
npm install @andhikapraa/qris
```

## Usage

```ts
import { convertQRIS, parseQRIS, validateQRIS } from "@andhikapraa/qris";

const staticCode = "0002010102112657...6304ABCD"; // merchant's static QRIS

const { valid, errors } = validateQRIS(staticCode);
if (!valid) throw new Error(errors.join("; "));

// Static → dynamic for a Rp 350.135 charge
const dynamic = convertQRIS(staticCode, { amount: 350135 });

// With a fixed Rp 2.000 convenience fee
convertQRIS(staticCode, { amount: 10000, fee: { type: "fixed", value: 2000 } });

// With a 0.7% convenience fee
convertQRIS(staticCode, { amount: 10000, fee: { type: "percentage", value: 0.7 } });

parseQRIS(dynamic).amount; // "350135"
```

`convertQRIS` validates the input and the amount by default and throws
`QRISError` on bad data. Pass `{ skipValidation: true }` to skip the input
check. `amount` must be a positive integer (IDR has no decimals).

## API

| Export | Description |
| --- | --- |
| `convertQRIS(qris, { amount, fee?, skipValidation? })` | Static → dynamic; recomputes CRC. Idempotent on already-dynamic codes. |
| `parseQRIS(qris)` | Structured `QRISData` (merchant, method, amount, fees…). |
| `validateQRIS(qris)` | `{ valid, errors[] }` — header, CRC, required tags. |
| `parseTLV(str)` | Raw recursive TLV element tree. |
| `calculateCRC16(str)` | CRC-16/CCITT-FALSE, 4-char uppercase hex. |
| `QRISError` | Thrown by `convertQRIS` on invalid input. |

## CLI

```bash
npx @andhikapraa/qris   # interactive static → dynamic prompt
```

## Notes

- EMVCo TLV length fields are byte-counted; values >99 bytes throw `QRISError`.
- Real-world QRIS payloads are ASCII — non-ASCII merchant data is encoded
  correctly but is outside the spec's normal range.

## License

MIT — derived from [verssache/qris-dinamis](https://github.com/verssache/qris-dinamis).
