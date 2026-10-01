import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const current = JSON.parse(await readFile("probe-output/status.json", "utf8"));
let previous = null;
try { previous = JSON.parse(await readFile("probe-output/previous-status.json", "utf8")); } catch {}
const title = "[incident] jam-public-devnet is unreachable";
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "scheduled monitor";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", env: process.env }).trim();
const open = gh("issue", "list", "--state", "open", "--search", `${title} in:title`, "--json", "number", "--jq", ".[0].number // empty");

if (current.state === "down" && !open) {
  const summary = current.current?.summary ?? {};
  gh("issue", "create", "--title", title, "--body", [
    `Two consecutive external probes could not complete a JAM UP0 handshake with any validator.`,
    "",
    `Observed: ${current.current?.observed_at ?? "unknown"}`,
    `WebTransport reachable: ${summary.reachable ?? 0}/${summary.configured ?? 6}`,
    `UP0 handshakes: ${summary.protocol ?? 0}/${summary.configured ?? 6}`,
    `Announcements: ${summary.announcing ?? 0}/${summary.configured ?? 6}`,
    "",
    `Probe run: ${runUrl}`
  ].join("\n"));
} else if (open && current.state !== "down" && current.state !== "recovering") {
  gh("issue", "comment", open, "--body", `Recovered after two consecutive non-down probes at ${current.generated_at}. Probe run: ${runUrl}`);
  gh("issue", "close", open, "--reason", "completed");
} else if (open && previous?.state !== current.state) {
  gh("issue", "comment", open, "--body", `Monitor state changed from ${previous?.state ?? "unknown"} to ${current.state} at ${current.generated_at}. Probe run: ${runUrl}`);
}
