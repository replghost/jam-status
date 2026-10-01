import { resolve } from "node:path";
import { startServer } from "./lib/server.mjs";

const root = resolve(process.argv[2] ?? "build");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const server = await startServer(root, port);
console.log(`Serving ${root} at ${server.origin}`);
await new Promise(() => {});
