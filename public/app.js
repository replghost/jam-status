import { probeAll } from "./probe.js";
import {
  comparePaths,
  describeValidatorProbe,
  isSafariProbeInconclusive,
  isWebTransportUnavailable
} from "./status.js";

const byId = (id) => document.getElementById(id);
const dataRoot = (document.documentElement.dataset.statusRoot ?? "./data").replace(/\/$/, "");
const stateLabel = byId("state-label");
const stateDetail = byId("state-detail");
const stateMark = byId("state-mark");
const validatorsBody = byId("validators");
const localButton = byId("run-local");
const comparison = byId("comparison");
const localDetails = byId("local-details");
const localValidators = byId("local-validators");
let external = null;

function age(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds} SEC AGO`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} MIN AGO`;
  return `${Math.floor(seconds / 3600)} HR AGO`;
}

function mark(ok, yes = "PASS", no = "FAIL") {
  return `<span class="${ok ? "pass" : "fail"}">${ok ? yes : no}</span>`;
}

function renderLocalResult(result, inconclusive = false) {
  localValidators.replaceChildren(...result.validators.map((validator) => {
    const description = describeValidatorProbe(validator);
    const attempts = (validator.attempts ?? [validator]).map(describeValidatorProbe);
    const status = inconclusive
      ? "INCONCLUSIVE"
      : attempts.length > 1
        ? description.ok ? "PASS ON RETRY" : `FAIL AFTER ${attempts.length} ATTEMPTS`
        : description.ok ? "PASS" : "FAIL";
    const evidence = attempts.length > 1
      ? attempts.map((attempt, index) => `${index === 0 ? "FIRST" : "RETRY"} ${attempt.stage}: ${attempt.detail}`).join(" / ")
      : `${description.stage} · ${description.detail}`;
    const row = document.createElement("div");
    row.className = `local-validator ${inconclusive ? "inconclusive" : description.ok ? "pass" : "fail"}`;

    const identity = document.createElement("b");
    identity.textContent = `V-${String(validator.id).padStart(2, "0")} / ${validator.endpoint}`;
    const outcome = document.createElement("span");
    outcome.textContent = `${status} · ${evidence}`;
    row.append(identity, outcome);
    return row;
  }));
  localDetails.hidden = false;
}

function renderStatus(status) {
  external = status.current;
  const stale = !external || Date.now() - Date.parse(external.observed_at) > 15 * 60_000;
  const state = stale ? "unknown" : status.state;
  document.body.dataset.state = state;
  stateLabel.textContent = state.toUpperCase();
  stateMark.textContent = state === "operational" ? "✓" : state === "down" ? "×" : state === "unknown" ? "?" : "!";
  stateDetail.textContent = stale
    ? "EXTERNAL RESULT IS MISSING OR STALE"
    : `${external.probe} / ${external.network} / ${external.site.ok ? "SITE ONLINE" : "SITE FAILURE"}`;
  const summary = external?.summary ?? {};
  byId("reachable").textContent = `${summary.reachable ?? "—"}/${summary.configured ?? 6}`;
  byId("protocol").textContent = `${summary.protocol ?? "—"}/${summary.configured ?? 6}`;
  byId("announcing").textContent = `${summary.announcing ?? "—"}/${summary.configured ?? 6}`;
  byId("last-check").textContent = external ? age(external.observed_at) : "NO DATA";

  validatorsBody.innerHTML = (external?.validators ?? []).map((validator) => `
    <tr>
      <td data-label="UNIT">V-${String(validator.id).padStart(2, "0")}</td>
      <td data-label="ENDPOINT">${validator.endpoint}</td>
      <td data-label="WEBTRANSPORT">${mark(validator.webtransport.ok)}</td>
      <td data-label="UP0">${mark(validator.up0.handshake)}</td>
      <td data-label="ANNOUNCEMENT">${mark(validator.up0.announcement)}</td>
      <td data-label="LATENCY">${validator.webtransport.latency_ms === undefined ? "—" : `${validator.webtransport.latency_ms} MS`}</td>
    </tr>`).join("") || "<tr class=\"validator-empty\"><td colspan=\"6\">NO VALIDATOR OBSERVATIONS</td></tr>";

  byId("availability").innerHTML = ["24h", "7d", "30d"].map((window) => {
    const metric = status.metrics?.[window] ?? {};
    const value = metric.availability_percent == null ? "—" : `${metric.availability_percent}%`;
    return `<div><label>${window.toUpperCase()} AVAILABLE</label><output>${value}</output><small>${metric.observations ?? 0} OBSERVATIONS · ${metric.monitor_coverage_percent ?? 0}% MONITOR COVERAGE</small></div>`;
  }).join("");
}


localButton.addEventListener("click", async () => {
  localButton.disabled = true;
  localButton.textContent = "TESTING SIX VALIDATORS…";
  comparison.textContent = "WEBTRANSPORT + JAM UP0 MAY TAKE UP TO 35 SECONDS";
  localDetails.hidden = true;
  localValidators.replaceChildren();
  try {
    const result = await probeAll({ retries: 1, retryDelayMs: 6_500 });
    globalThis.__jamStatusLocalResult = result;
    comparison.textContent = comparePaths(external, result, navigator.userAgent);
    renderLocalResult(
      result,
      isSafariProbeInconclusive(result, navigator.userAgent) || isWebTransportUnavailable(result)
    );
  } catch (error) {
    comparison.textContent = `LOCAL MONITOR ERROR — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    localButton.disabled = false;
    localButton.textContent = "RUN TEST FROM THIS BROWSER >>>";
  }
});

try {
  const [statusResponse, historyResponse] = await Promise.all([
    fetch(`${dataRoot}/status.json`, { cache: "no-store" }),
    fetch(`${dataRoot}/history.jsonl`, { cache: "no-store" })
  ]);
  if (!statusResponse.ok) throw new Error(`status HTTP ${statusResponse.status}`);
  renderStatus(await statusResponse.json());
  const lines = historyResponse.ok ? (await historyResponse.text()).trim().split("\n").filter(Boolean) : [];
  byId("timeline").innerHTML = lines.slice(-48).map((line) => {
    const record = JSON.parse(line);
    return `<i data-state="${record.summary?.raw_state ?? "unknown"}" title="${record.observed_at}: ${record.summary?.raw_state ?? "unknown"}"></i>`;
  }).join("");
} catch (error) {
  renderStatus({ state: "unknown", current: null, metrics: {} });
  stateDetail.textContent = `STATUS DATA ERROR — ${error instanceof Error ? error.message : String(error)}`;
}
