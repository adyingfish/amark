import { spawn } from "node:child_process";
import { once } from "node:events";
import electron from "electron";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1" } });
await server.listen();
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, AMARK_DEV_URL: server.resolvedUrls.local[0] },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill());
}
try {
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally {
  await server.close();
}
