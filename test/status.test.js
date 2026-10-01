import test from "node:test";
import assert from "node:assert/strict";
import { derive } from "../src/status.js";

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
