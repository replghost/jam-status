import { hexToBytes, webTransportCertificateHashes } from "./certificates.js";
import { NETWORK } from "./network.js";

const MAX_FRAME_BYTES = 1 << 20;

export class ProbeError extends Error {
  constructor(phase, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProbeError";
    this.phase = phase;
  }
}

function timeout(promise, milliseconds, phase) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ProbeError(phase, `${phase} timed out after ${milliseconds} ms`)), milliseconds);
  });
  return Promise.race([promise, expired])
    .catch((error) => {
      if (error instanceof ProbeError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ProbeError(phase, `${phase} failed: ${message}`, error);
    })
    .finally(() => clearTimeout(timer));
}

function u32le(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export function framed(message) {
  const out = new Uint8Array(4 + message.length);
  out.set(u32le(message.length), 0);
  out.set(message, 4);
  return out;
}

export function clientHandshake(genesis) {
  const hash = hexToBytes(genesis);
  if (hash.length !== 32) throw new Error("genesis must be 32 bytes");
  const out = new Uint8Array(37);
  out.set(hash, 0);
  // Claimed final slot is zero, followed by compact zero leaves.
  return out;
}

function compactNatural(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined) throw new ProbeError("up0_handshake", "missing compact leaf count");
  if (first === 0xff) {
    if (offset + 9 > bytes.length) throw new ProbeError("up0_handshake", "truncated compact leaf count");
    let value = 0n;
    for (let i = 8; i > 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]);
    return { value, length: 9 };
  }
  let extra = 0;
  while (extra < 8 && (first & (0x80 >> extra)) !== 0) extra += 1;
  if (offset + 1 + extra > bytes.length) throw new ProbeError("up0_handshake", "truncated compact leaf count");
  let low = 0n;
  for (let i = extra; i > 0; i -= 1) low = (low << 8n) | BigInt(bytes[offset + i]);
  const high = BigInt(first - (256 - (1 << (8 - extra))));
  return { value: (high << BigInt(8 * extra)) | low, length: 1 + extra };
}

export function parsePeerHandshake(message) {
  if (message.length < 37) throw new ProbeError("up0_handshake", `handshake is only ${message.length} bytes`);
  const finalizedSlot = new DataView(message.buffer, message.byteOffset + 32, 4).getUint32(0, true);
  const leaves = compactNatural(message, 36);
  if (leaves.value > 4096n) throw new ProbeError("up0_handshake", "handshake leaf count is unreasonable");
  const expected = 36 + leaves.length + Number(leaves.value) * 36;
  if (message.length !== expected) {
    throw new ProbeError("up0_handshake", `handshake length ${message.length} does not match ${expected}`);
  }
  return { finalizedSlot, leaves: Number(leaves.value) };
}

export function parseAnnouncement(message) {
  if (message.length <= 36) throw new ProbeError("up0_announcement", "announcement has no encoded header");
  const finalizedSlot = new DataView(message.buffer, message.byteOffset + message.length - 4, 4).getUint32(0, true);
  const headerSlot = new DataView(message.buffer, message.byteOffset + 96, 4).getUint32(0, true);
  return { finalizedSlot, headerSlot, bytes: message.length };
}

class FrameReader {
  constructor(reader) {
    this.reader = reader;
    this.buffer = new Uint8Array();
  }

  async next(milliseconds, phase) {
    const deadline = performance.now() + milliseconds;
    while (true) {
      if (this.buffer.length >= 4) {
        const length = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4).getUint32(0, true);
        if (length > MAX_FRAME_BYTES) throw new ProbeError(phase, `frame length ${length} exceeds ${MAX_FRAME_BYTES}`);
        if (this.buffer.length >= 4 + length) {
          const message = this.buffer.slice(4, 4 + length);
          this.buffer = this.buffer.slice(4 + length);
          return message;
        }
      }
      const remaining = Math.max(1, deadline - performance.now());
      const chunk = await timeout(this.reader.read(), remaining, phase);
      if (chunk.done) throw new ProbeError(phase, "stream ended before a complete frame");
      const next = new Uint8Array(this.buffer.length + chunk.value.length);
      next.set(this.buffer);
      next.set(chunk.value, this.buffer.length);
      this.buffer = next;
    }
  }
}

function cleanError(error) {
  const phase = error instanceof ProbeError ? error.phase : "internal";
  const message = error instanceof Error ? error.message : String(error);
  return { phase, message: message.slice(0, 300) };
}

export async function probeValidator(validator, options = {}) {
  const dialTimeoutMs = options.dialTimeoutMs ?? 10_000;
  const streamTimeoutMs = options.streamTimeoutMs ?? 10_000;
  const announcementTimeoutMs = options.announcementTimeoutMs ?? 12_000;
  const started = performance.now();
  const result = {
    id: validator.id,
    endpoint: `${validator.ip}:${validator.port}`,
    webtransport: { ok: false },
    up0: { handshake: false, announcement: false }
  };
  let transport;
  try {
    if (typeof WebTransport !== "function") throw new ProbeError("unsupported", "WebTransport is unavailable in this browser");
    const compressed = hexToBytes(validator.p256);
    const hashes = await webTransportCertificateHashes(compressed, Math.floor(Date.now() / 1000));
    transport = new WebTransport(`https://${validator.ip}:${validator.port}`, {
      serverCertificateHashes: hashes.map((value) => ({ algorithm: "sha-256", value }))
    });
    await timeout(transport.ready, dialTimeoutMs, "webtransport_ready");
    result.webtransport = { ok: true, latency_ms: Math.round(performance.now() - started) };

    const stream = await timeout(transport.createBidirectionalStream(), streamTimeoutMs, "up0_open");
    const writer = stream.writable.getWriter();
    const frames = new FrameReader(stream.readable.getReader());
    await timeout(writer.write(Uint8Array.of(0)), streamTimeoutMs, "up0_kind");
    await timeout(writer.write(framed(clientHandshake(NETWORK.genesis))), streamTimeoutMs, "up0_send");

    const handshake = parsePeerHandshake(await frames.next(streamTimeoutMs, "up0_handshake"));
    result.up0 = { handshake: true, announcement: false, handshake_finalized_slot: handshake.finalizedSlot, leaves: handshake.leaves };
    try {
      const announcement = parseAnnouncement(await frames.next(announcementTimeoutMs, "up0_announcement"));
      result.up0 = { ...result.up0, announcement: true, ...announcement };
    } catch (error) {
      result.up0.announcement_error = cleanError(error);
    }
  } catch (error) {
    result.error = cleanError(error);
  } finally {
    result.duration_ms = Math.round(performance.now() - started);
    try { transport?.close(); } catch { /* never became ready */ }
  }
  return result;
}

export async function probeAll(options = {}) {
  const { retries = 0, retryDelayMs = 1_000, ...probeOptions } = options;
  const validatorsById = new Map(NETWORK.validators.map((validator) => [validator.id, validator]));
  let validators = await Promise.all(NETWORK.validators.map((validator) => probeValidator(validator, probeOptions)));

  for (let retry = 0; retry < retries; retry += 1) {
    const failed = validators.filter((validator) => !validator.up0.announcement);
    if (failed.length === 0) break;
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

    const retried = await Promise.all(failed.map((prior) => probeValidator(validatorsById.get(prior.id), probeOptions)));
    const replacements = new Map(retried.map((result, index) => {
      const prior = failed[index];
      return [result.id, { ...result, attempts: [...(prior.attempts ?? [prior]), result] }];
    }));
    validators = validators.map((validator) => replacements.get(validator.id) ?? validator);
  }

  const reachable = validators.filter((validator) => validator.webtransport.ok).length;
  const protocol = validators.filter((validator) => validator.up0.handshake).length;
  const announcing = validators.filter((validator) => validator.up0.announcement).length;
  const rawState = announcing === validators.length
    ? "operational"
    : protocol > 0
      ? "degraded"
      : "down";
  return { validators, summary: { configured: validators.length, reachable, protocol, announcing, raw_state: rawState } };
}
