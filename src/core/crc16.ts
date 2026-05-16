const _encoder = new TextEncoder();

/**
 * Calculate the CRC-16/CCITT-FALSE checksum used by QRIS / EMVCo QR codes.
 * Polynomial: 0x1021, Init: 0xFFFF, no input/output reflection, no xorout.
 *
 * The checksum is computed over the **UTF-8 bytes** of the payload (EMVCo
 * length fields are byte counts), so non-ASCII merchant data checksums
 * consistently with how it is serialized and parsed.
 *
 * @returns 4-character uppercase hex string.
 */
export function calculateCRC16(input: string): string {
  const bytes = _encoder.encode(input);
  let crc = 0xffff;

  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] as number) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
