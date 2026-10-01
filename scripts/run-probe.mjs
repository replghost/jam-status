import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { NETWORK } from "../src/network.js";
import { startServer } from "./lib/server.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return "/usr/bin/google-chrome";
}

async function probeSite() {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(NETWORK.appUrl, { signal: controller.signal, redirect: "follow" });
    const text = await response.text();
    return {
      ok: response.ok && /Polkadot/i.test(text),
      status: response.status,
      latency_ms: Math.round(performance.now() - started),
      final_url: response.url
    };
  } catch (error) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message.slice(0, 300) : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

const output = resolve(argument("--output", "probe-output/latest.json"));
const probeId = process.env.PROBE_ID ?? "local";
const server = await startServer(resolve("."));
let browser;
let network;
let monitorError;
try {
  browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
    protocolTimeout: 90_000
  });
  const page = await browser.newPage();
  await page.goto(`${server.origin}/public/probe-runner.html`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  network = await page.evaluate(async () => {
    const { probeAll } = await import("/src/probe.js");
    return probeAll();
  });
} catch (error) {
  monitorError = error instanceof Error ? error.message.slice(0, 500) : String(error);
} finally {
  await browser?.close();
  await server.close();
}

const record = {
  schema: 1,
  observed_at: new Date().toISOString(),
  probe: probeId,
  network: NETWORK.name,
  site: await probeSite(),
  ...(network ?? {
    validators: [],
    summary: { configured: NETWORK.validators.length, reachable: 0, protocol: 0, announcing: 0, raw_state: "unknown" }
  }),
  ...(monitorError === undefined ? {} : { monitor_error: monitorError })
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record));
