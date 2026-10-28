import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = await buildApp();

app.listen({ port: config.port, host: "0.0.0.0" }).then(
  (addr) => app.log.info(`EC Service listening on ${addr}`),
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
