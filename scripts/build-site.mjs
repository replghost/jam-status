import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function copyOr(path, destination, fallback) {
  try {
    await cp(resolve(path), resolve(destination));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(resolve(destination), fallback);
  }
}

await mkdir("build/data", { recursive: true });
await cp("public", "build", { recursive: true });
await cp("src", "build/src", { recursive: true });
await copyOr("probe-output/status.json", "build/data/status.json", "{\"state\":\"unknown\",\"current\":null,\"metrics\":{}}\n");
await copyOr("probe-output/latest.json", "build/data/latest.json", "null\n");
await copyOr("probe-output/history.jsonl", "build/data/history.jsonl", "");
await copyOr("probe-output/incidents.json", "build/data/incidents.json", "[]\n");
const status = JSON.parse(await readFile("build/data/status.json", "utf8"));
await writeFile("build/data/build.json", `${JSON.stringify({ generated_at: new Date().toISOString(), state: status.state })}\n`);
