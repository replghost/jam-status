import test from "node:test";
import assert from "node:assert/strict";
import { comparePaths, derive, describeValidatorProbe } from "../src/status.js";

const base = Date.parse("2026-10-01T00:00:00Z");
function record(minutes, state) {
  return {
    schema: 1,
    observed_at: new Date(base + minutes * 60_000).toISOString(),
    probe: "test",
    summary: { raw_state: state }
  };
}

test("one failed observation investigates; two declare an incident", () => {
  assert.equal(derive([record(0, "operational"), record(5, "down")], base + 5 * 60_000).state, "investigating");
  const result = derive([record(0, "operational"), record(5, "down"), record(10, "down")], base + 10 * 60_000);
  assert.equal(result.state, "down");
  assert.deepEqual(result.incidents[0], {
    started_at: record(5, "down").observed_at,
    detected_at: record(10, "down").observed_at,
    ended_at: null,
    state: "ongoing"
  });
});

test("an incident requires two healthy observations to resolve", () => {
  const recovering = derive([
    record(0, "down"), record(5, "down"), record(10, "operational")
  ], base + 10 * 60_000);
  assert.equal(recovering.state, "recovering");
  const recovered = derive([
    record(0, "down"), record(5, "down"), record(10, "degraded"), record(15, "operational")
  ], base + 15 * 60_000);
  assert.equal(recovered.state, "operational");
  assert.equal(recovered.incidents[0].state, "resolved");
  assert.equal(recovered.incidents[0].ended_at, record(15, "operational").observed_at);
});

test("stale data is unknown rather than down", () => {
  const result = derive([record(0, "operational")], base + 16 * 60_000);
  assert.equal(result.state, "unknown");
});

test("different non-down path states report the local validator count", () => {
  const external = { summary: { raw_state: "operational", configured: 6, announcing: 6 } };
  const local = {
    summary: { raw_state: "degraded", configured: 6, announcing: 5 },
    validators: Array.from({ length: 6 }, () => ({ error: null }))
  };
  assert.equal(
    comparePaths(external, local),
    "EXTERNAL OPERATIONAL, LOCAL DEGRADED — PARTIAL PATH DIFFERENCE (5/6 ANNOUNCING LOCALLY)"
  );
});

test("matching path states are the only non-down states labeled as agreeing", () => {
  const external = { summary: { raw_state: "degraded" } };
  const local = { summary: { raw_state: "degraded" }, validators: [{}] };
  assert.match(comparePaths(external, local), /PATHS AGREE$/);
});

test("local validator diagnostics identify the failed endpoint phase and reason", () => {
  assert.deepEqual(describeValidatorProbe({
    duration_ms: 12_003,
    up0: {
      handshake: true,
      announcement: false,
      announcement_error: {
        phase: "up0_announcement",
        message: "up0_announcement timed out after 12000 ms"
      }
    }
  }), {
    ok: false,
    stage: "UP0 ANNOUNCEMENT",
    detail: "up0_announcement timed out after 12000 ms"
  });
});

test("all pre-transport failures on Safari are inconclusive rather than network down", () => {
  const external = { summary: { raw_state: "operational" } };
  const local = {
    summary: { raw_state: "down", configured: 6, announcing: 0 },
    validators: Array.from({ length: 6 }, (_, id) => ({
      id,
      webtransport: { ok: false },
      error: { phase: "webtransport_ready", message: "Opening handshake failed." }
    }))
  };
  const mobileSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1";
  assert.equal(
    comparePaths(external, local, mobileSafari),
    "SAFARI/IOS TEST INCONCLUSIVE — CERTIFICATE-PINNED WEBTRANSPORT FAILED BEFORE JAM UP0; EXTERNAL RESULT ONLY"
  );
});
