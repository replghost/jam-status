// Adapted from paritytech/host-rust-core under the MIT license; see NOTICE.
export const UNPADDED_VALIDITY_PERIOD_SECS = 10 * 24 * 3600;
export const VALIDITY_PERIOD_PADDING_SECS = 24 * 3600;

const BITS_TO_CHAR = "abcdefghijklmnopqrstuvwxyz234567";
const P = (1n << 256n) - (1n << 224n) + (1n << 192n) + (1n << 96n) - 1n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const OID_ED25519 = [0x06, 0x03, 0x2b, 0x65, 0x70];
const OID_EC_PUBLIC_KEY = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const OID_PRIME256V1 = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
const OID_SUBJECT_ALT_NAME = [0x06, 0x03, 0x55, 0x1d, 0x11];
const ascii = new TextEncoder();

export function hexToBytes(hex) {
  const value = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) throw new Error("invalid hex");
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function peerIdText(prefix, bytes) {
  if (bytes.length !== 32) throw new Error("peer id needs 32 bytes");
  let text = prefix;
  for (let i = 0; i < 256; i += 5) {
    const low = bytes[i >> 3];
    const high = bytes[(i >> 3) + 1] ?? 0;
    text += BITS_TO_CHAR[((low | (high << 8)) >> (i % 8)) & 0x1f];
  }
  return text;
}

function bigintFromBytes(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bytesFromBigint(value, length) {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}

export function decompressP256(compressed) {
  if (compressed.length !== 33 || (compressed[0] !== 2 && compressed[0] !== 3)) {
    throw new Error("expected a 33-byte compressed P-256 point");
  }
  const x = bigintFromBytes(compressed.subarray(1));
  if (x >= P) throw new Error("P-256 x coordinate out of range");
  const alpha = ((((x * x) % P) * x - 3n * x + B) % P + P) % P;
  let y = modPow(alpha, (P + 1n) >> 2n, P);
  if ((y * y) % P !== alpha) throw new Error("P-256 x coordinate is not on the curve");
  if ((y & 1n) !== BigInt(compressed[0] & 1)) y = P - y;
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(bytesFromBigint(x, 32), 1);
  out.set(bytesFromBigint(y, 32), 33);
  return out;
}

function der(tag, ...parts) {
  const body = parts.flatMap((part) => Array.from(part));
  const length = body.length;
  const header = length < 0x80
    ? [tag, length]
    : length < 0x100
      ? [tag, 0x81, length]
      : [tag, 0x82, length >> 8, length & 0xff];
  return header.concat(body);
}

function derUnsigned(value) {
  const bytes = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  if (bytes.length === 0 || bytes[0] >= 0x80) bytes.unshift(0);
  return der(0x02, bytes);
}

function utcTime(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const year = date.getUTCFullYear();
  if (year < 1950 || year >= 2050) throw new Error("certificate validity is outside UTCTime range");
  const two = (value) => String(value).padStart(2, "0");
  const text = `${two(year % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
  return der(0x17, ascii.encode(text));
}

const JAM_DN = der(0x30, der(0x31, der(0x30, [0x06, 0x03, 0x55, 0x04, 0x03], der(0x0c, ascii.encode("jam")))));
const ED25519_ALG = der(0x30, OID_ED25519);

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function validityPeriodAt(unixSeconds) {
  return Math.floor(unixSeconds / UNPADDED_VALIDITY_PERIOD_SECS);
}

export function validityBounds(period) {
  return [
    Math.max(period * UNPADDED_VALIDITY_PERIOD_SECS - VALIDITY_PERIOD_PADDING_SECS, 0),
    (period + 1) * UNPADDED_VALIDITY_PERIOD_SECS + VALIDITY_PERIOD_PADDING_SECS
  ];
}

export async function webTransportSerial(compressed, period) {
  const input = new Uint8Array(compressed.length + 8);
  input.set(compressed);
  input.set(bytesFromBigint(BigInt(period), 8), compressed.length);
  const serial = bigintFromBytes((await sha256(input)).subarray(0, 8)) & ((1n << 63n) - 1n);
  return serial === 0n ? 1n : serial;
}

export async function webTransportCertificateDer(compressed, period, serialKind) {
  const point = decompressP256(compressed);
  const altName = peerIdText(compressed[0] === 3 ? "o" : "v", compressed.subarray(1));
  const [notBefore, notAfter] = validityBounds(period);
  const spki = der(0x30, der(0x30, OID_EC_PUBLIC_KEY, OID_PRIME256V1), der(0x03, [0x00], point));
  const san = der(0x30, der(0x30, OID_SUBJECT_ALT_NAME, der(0x04, der(0x30, der(0x82, ascii.encode(altName))))));
  const serial = serialKind === "distinct" ? await webTransportSerial(compressed, period) : 0n;
  const tbs = der(
    0x30,
    der(0xa0, der(0x02, [0x02])),
    derUnsigned(serial),
    ED25519_ALG,
    JAM_DN,
    der(0x30, utcTime(notBefore), utcTime(notAfter)),
    JAM_DN,
    spki,
    der(0xa3, san)
  );
  return Uint8Array.from(der(0x30, tbs, ED25519_ALG, der(0x03, [0x00], new Uint8Array(64))));
}

export async function webTransportCertificateHash(compressed, period, serialKind) {
  return sha256(await webTransportCertificateDer(compressed, period, serialKind));
}

export async function webTransportCertificateHashes(compressed, unixSeconds) {
  const period = validityPeriodAt(unixSeconds);
  const hashes = [];
  for (const candidate of [period - 1, period, period + 1]) {
    if (candidate < 0) continue;
    hashes.push(await webTransportCertificateHash(compressed, candidate, "distinct"));
    hashes.push(await webTransportCertificateHash(compressed, candidate, "legacy"));
  }
  return hashes;
}
