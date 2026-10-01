import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function copyOr(path, destination, fallback) {
  try {
    await cp(resolve(path), resolve(destination));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(resolve(destination), fallback);
  }
}

await rm("build", { recursive: true, force: true });
await mkdir("build/data", { recursive: true });
await cp("public", "build", { recursive: true });
for (const module of ["certificates.js", "network.js", "probe.js", "status.js"]) {
  await cp(`src/${module}`, `build/${module}`);
}
await copyOr("probe-output/status.json", "build/data/status.json", "{\"state\":\"unknown\",\"current\":null,\"metrics\":{}}\n");
await copyOr("probe-output/latest.json", "build/data/latest.json", "null\n");
await copyOr("probe-output/history.jsonl", "build/data/history.jsonl", "");
await copyOr("probe-output/incidents.json", "build/data/incidents.json", "[]\n");
const status = JSON.parse(await readFile("build/data/status.json", "utf8"));
await writeFile("build/data/build.json", `${JSON.stringify({ generated_at: new Date().toISOString(), state: status.state })}\n`);
