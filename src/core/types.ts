/** A single TLV (Tag-Length-Value) element from a QRIS payload */
export interface TLV {
  tag: string;
  name: string;
  length: number;
  value: string;
  children?: TLV[];
}

/** Parsed QRIS data in a human-friendly structure */
export interface QRISData {
  version: string;
  method: "static" | "dynamic" | "unknown";
  merchantAccountInfo: MerchantAccountInfo[];
  merchantCategoryCode: string;
  currency: string;
  amount?: string;
  tipIndicator?: "prompt" | "fixed" | "percentage";
  tipFixed?: string;
  tipPercentage?: string;
  countryCode: string;
  merchantName: string;
  merchantCity: string;
  postalCode: string;
  additionalData?: TLV[];
  crc: string;
  raw: TLV[];
}

export interface MerchantAccountInfo {
  tag: string;
  globallyUniqueId: string;
  merchantId?: string;
  merchantCriteria?: string;
  fields: TLV[];
}

/**
 * Optional surcharge folded into the transaction amount. The percentage
 * applies to the base amount only. Same `{ type, value }` envelope for every
 * case. EMVCo has no indicator for a combined fee (tag 55 is single-valued),
 * and the indicator is inconsistently honored across bank apps, so this
 * library always folds the fee into the amount rather than emitting tags
 * 55/56/57 — the payer scans one all-in total.
 */
export type Fee =
  | { type: "fixed"; value: number }
  | { type: "percentage"; value: number }
  | { type: "combined"; value: { fixed: number; percentage: number } };

export interface ConvertOptions {
  /** Base transaction amount in IDR rupiah (integer, > 0). */
  amount: number;
  /** Optional surcharge folded into the final amount. */
  fee?: Fee;
  /**
   * Skip validating the input QRIS before converting.
   * @default false
   */
  skipValidation?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Thrown when conversion input is structurally or semantically invalid. */
export class QRISError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QRISError";
  }
}
