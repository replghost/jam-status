import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { derive } from "../src/status.js";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function optionalText(path, fallback = "") {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}


const latestPath = resolve(argument("--latest", "probe-output/latest.json"));
const historyPath = resolve(argument("--history", "probe-output/history.jsonl"));
const statusPath = resolve(argument("--status", "probe-output/status.json"));
const incidentsPath = resolve(argument("--incidents", "probe-output/incidents.json"));
const now = Date.parse(argument("--now", new Date().toISOString()));
const latest = JSON.parse(await readFile(latestPath, "utf8"));
if (latest.schema !== 1 || !Number.isFinite(Date.parse(latest.observed_at)) || !latest.probe) {
  throw new Error("latest probe record does not satisfy schema 1");
}
const prior = (await optionalText(historyPath)).split("\n").filter(Boolean).map((line) => JSON.parse(line));
const byIdentity = new Map(prior.map((record) => [`${record.observed_at}\0${record.probe}`, record]));
byIdentity.set(`${latest.observed_at}\0${latest.probe}`, latest);
const cutoff = now - 90 * 24 * 3600_000;
const history = [...byIdentity.values()]
  .filter((record) => Date.parse(record.observed_at) >= cutoff)
  .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
const derived = derive(history, now);
const status = {
  schema: 1,
  generated_at: new Date(now).toISOString(),
  state: derived.state,
  current: derived.latest,
  metrics: derived.metrics
};
await Promise.all([historyPath, statusPath, incidentsPath].map((path) => mkdir(dirname(path), { recursive: true })));
await writeFile(historyPath, history.map((record) => JSON.stringify(record)).join("\n") + "\n");
await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
await writeFile(incidentsPath, `${JSON.stringify(derived.incidents, null, 2)}\n`);
console.log(JSON.stringify({ state: status.state, observations: history.length, incidents: derived.incidents.length }));
