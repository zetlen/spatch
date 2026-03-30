// B64.ts — URL-safe Base64 encode/decode for register packing.
//
// Uses a 64-character alphabet (A-Z, a-z, 0-9, -, _) where each character
// Represents 6 bits. These are the atomic read/write operations for the
// Register-based wire format.

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_MAP = new Map([...B64_CHARS].map((c, i) => [c, i]));

/** Encode a non-negative integer into `chars` B64 characters (big-endian). */
export function encodeInt(val: number, chars: number): string {
  let res = '';
  val = Math.max(0, Math.floor(val || 0));
  for (let i = 0; i < chars; i++) {
    res = B64_CHARS[val & 0x3f] + res;
    val = Math.floor(val / 64);
  }
  return res;
}

/** Decode `chars` B64 characters starting at `startIndex` into an integer. */
export function decodeInt(str: string, startIndex: number, chars: number): number {
  if (startIndex + chars > str.length) {
    throw new Error('Unexpected end of input during parsing');
  }
  let val = 0;
  for (let i = 0; i < chars; i++) {
    val = val * 64 + (B64_MAP.get(str.charAt(startIndex + i)) || 0);
  }
  return val;
}
