export function rawState(record) {
  if (record.monitor_error || record.summary?.raw_state === "unknown") return "unknown";
  return record.summary?.raw_state ?? "unknown";
}

export function derive(records, now = Date.now()) {
  const sorted = [...records].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  let downRun = [];
  let recoveryRun = [];
  let activeIncident = null;
  const incidents = [];

  for (const record of sorted) {
    const state = rawState(record);
    if (state === "down") {
      recoveryRun = [];
      downRun.push(record);
      if (downRun.length > 2) downRun.shift();
      if (activeIncident === null && downRun.length === 2) {
        activeIncident = {
          started_at: downRun[0].observed_at,
          detected_at: downRun[1].observed_at,
          ended_at: null,
          state: "ongoing"
        };
        incidents.push(activeIncident);
      }
    } else if (state === "operational" || state === "degraded") {
      downRun = [];
      if (activeIncident !== null) {
        recoveryRun.push(record);
        if (recoveryRun.length === 2) {
          activeIncident.ended_at = record.observed_at;
          activeIncident.state = "resolved";
          activeIncident = null;
          recoveryRun = [];
        }
      }
    }
  }

  const latest = sorted.at(-1) ?? null;
  let state = latest === null ? "unknown" : rawState(latest);
  if (latest !== null && now - Date.parse(latest.observed_at) > 15 * 60_000) state = "unknown";
  else if (activeIncident !== null) state = rawState(latest) === "down" ? "down" : "recovering";
  else if (downRun.length === 1) state = "investigating";

  const metrics = {};
  for (const [label, duration] of [["24h", 24 * 3600_000], ["7d", 7 * 24 * 3600_000], ["30d", 30 * 24 * 3600_000]]) {
    const start = now - duration;
    const sample = sorted.filter((record) => Date.parse(record.observed_at) >= start && rawState(record) !== "unknown");
    const available = sample.filter((record) => rawState(record) !== "down").length;
    const operational = sample.filter((record) => rawState(record) === "operational").length;
    const first = sample[0] ? Math.max(start, Date.parse(sample[0].observed_at)) : now;
    const expected = Math.max(1, Math.floor((now - first) / 300_000) + 1);
    metrics[label] = {
      observations: sample.length,
      availability_percent: sample.length === 0 ? null : Number((100 * available / sample.length).toFixed(3)),
      fully_operational_percent: sample.length === 0 ? null : Number((100 * operational / sample.length).toFixed(3)),
      monitor_coverage_percent: sample.length === 0 ? 0 : Number((100 * Math.min(sample.length, expected) / expected).toFixed(3))
    };
  }
  return { state, latest, metrics, incidents };
}

export function comparePaths(external, local) {
  if (local.validators?.length > 0 && local.validators.every((validator) => validator.error?.phase === "unsupported")) {
    return "THIS BROWSER DOES NOT EXPOSE WEBTRANSPORT — EXTERNAL RESULT ONLY";
  }

  const externalState = external?.summary?.raw_state ?? "unknown";
  const localState = local.summary?.raw_state ?? "unknown";
  if (externalState === localState) {
    if (localState === "down") return "EXTERNAL + LOCAL DOWN — LIKELY SHARED VALIDATOR/VPS OUTAGE";
    return `EXTERNAL ${externalState.toUpperCase()}, LOCAL ${localState.toUpperCase()} — PATHS AGREE`;
  }
  if (localState === "down") return "EXTERNAL UP, LOCAL DOWN — LIKELY BROWSER/ROUTER/ISP PATH";
  if (externalState === "down") return "EXTERNAL DOWN, LOCAL UP — MONITOR OR REGIONAL PATH ISSUE";

  const announcing = local.summary?.announcing ?? 0;
  const configured = local.summary?.configured ?? local.validators?.length ?? 0;
  return `EXTERNAL ${externalState.toUpperCase()}, LOCAL ${localState.toUpperCase()} — PARTIAL PATH DIFFERENCE (${announcing}/${configured} ANNOUNCING LOCALLY)`;
}

export function describeValidatorProbe(validator) {
  if (validator.up0?.announcement) {
    return { ok: true, stage: "ANNOUNCEMENT", detail: `${validator.duration_ms} MS` };
  }

  const error = validator.up0?.announcement_error ?? validator.error;
  return {
    ok: false,
    stage: (error?.phase ?? "unknown").replaceAll("_", " ").toUpperCase(),
    detail: error?.message ?? "Probe ended before a block announcement"
  };
}
