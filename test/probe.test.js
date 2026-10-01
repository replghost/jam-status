import test from "node:test";
import assert from "node:assert/strict";
import { framed, parsePeerHandshake, probeAll, probeValidator } from "../src/probe.js";
import { NETWORK } from "../src/network.js";

function u32(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

function peerHandshake(slot) {
  const message = new Uint8Array(37);
  u32(message, 32, slot);
  return message;
}

function announcement(headerSlot, finalizedSlot) {
  const message = new Uint8Array(140);
  u32(message, 96, headerSlot);
  u32(message, message.length - 4, finalizedSlot);
  return message;
}

test("peer handshake parser rejects framing mismatches", () => {
  assert.deepEqual(parsePeerHandshake(peerHandshake(42)), { finalizedSlot: 42, leaves: 0 });
  const malformed = peerHandshake(42);
  malformed[36] = 1;
  assert.throws(() => parsePeerHandshake(malformed), /does not match/);
});

test("validator probe proves WebTransport, UP0 handshake, and announcement", async () => {
  const bytes = new Uint8Array([...framed(peerHandshake(91)), ...framed(announcement(95, 94))]);
  class FakeWebTransport {
    constructor() { this.ready = Promise.resolve(); }
    async createBidirectionalStream() {
      return {
        writable: new WritableStream({ write() {} }),
        readable: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })
      };
    }
    close() {}
  }
  const original = globalThis.WebTransport;
  globalThis.WebTransport = FakeWebTransport;
  try {
    const result = await probeValidator(NETWORK.validators[0], { dialTimeoutMs: 50, streamTimeoutMs: 50, announcementTimeoutMs: 50 });
    assert.equal(result.webtransport.ok, true);
    assert.equal(result.up0.handshake, true);
    assert.equal(result.up0.announcement, true);
    assert.equal(result.up0.handshake_finalized_slot, 91);
    assert.equal(result.up0.headerSlot, 95);
    assert.equal(result.up0.finalizedSlot, 94);
  } finally {
    globalThis.WebTransport = original;
  }
});

test("browser probe retries only validators that failed the first announcement path", async () => {
  const bytes = new Uint8Array([...framed(peerHandshake(91)), ...framed(announcement(95, 94))]);
  let connections = 0;
  class FlakyWebTransport {
    constructor() {
      connections += 1;
      this.ready = connections <= 2
        ? Promise.reject(new Error("Opening handshake failed."))
        : Promise.resolve();
    }
    async createBidirectionalStream() {
      return {
        writable: new WritableStream({ write() {} }),
        readable: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })
      };
    }
    close() {}
  }
  const original = globalThis.WebTransport;
  globalThis.WebTransport = FlakyWebTransport;
  try {
    const result = await probeAll({
      retries: 1,
      retryDelayMs: 0,
      dialTimeoutMs: 50,
      streamTimeoutMs: 50,
      announcementTimeoutMs: 50
    });
    assert.equal(result.summary.announcing, 6);
    assert.equal(connections, 8);
    assert.equal(result.validators[0].attempts.length, 2);
    assert.equal(result.validators[1].attempts.length, 2);
    assert.equal(result.validators[2].attempts, undefined);
  } finally {
    globalThis.WebTransport = original;
  }
});

test("validator probe reports the exact timeout phase", async () => {
  class HangingWebTransport {
    constructor() { this.ready = new Promise(() => {}); }
    close() {}
  }
  const original = globalThis.WebTransport;
  globalThis.WebTransport = HangingWebTransport;
  try {
    const result = await probeValidator(NETWORK.validators[0], { dialTimeoutMs: 2 });
    assert.equal(result.webtransport.ok, false);
    assert.equal(result.error.phase, "webtransport_ready");
  } finally {
    globalThis.WebTransport = original;
  }
});

test("validator probe attributes browser handshake rejection to WebTransport readiness", async () => {
  class RejectedWebTransport {
    constructor() { this.ready = Promise.reject(new Error("Opening handshake failed.")); }
    close() {}
  }
  const original = globalThis.WebTransport;
  globalThis.WebTransport = RejectedWebTransport;
  try {
    const result = await probeValidator(NETWORK.validators[0], { dialTimeoutMs: 50 });
    assert.equal(result.error.phase, "webtransport_ready");
    assert.match(result.error.message, /Opening handshake failed/);
  } finally {
    globalThis.WebTransport = original;
  }
});
