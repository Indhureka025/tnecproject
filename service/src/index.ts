import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const config = loadConfig();
const app = await buildApp();

app.listen({ port: config.port, host: "0.0.0.0" }).then(
  (addr) => app.log.info(`EC Service listening on ${addr}`),
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
