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

export interface ConvertOptions {
  /** Transaction amount in the smallest currency unit (IDR rupiah, integer, > 0). */
  amount: number;
  fee?: {
    type: "fixed" | "percentage";
    /** Rupiah for "fixed", percent for "percentage" (e.g. 0.7 = 0.7%). */
    value: number;
  };
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
