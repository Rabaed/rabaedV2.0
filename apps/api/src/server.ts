import { createDbFromEnv } from "@rabaed/db";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { apiConfigFromEnv } from "./config.ts";

const env = z
  .object({
    API_HOST: z.string().default("127.0.0.1"),
    API_PORT: z.coerce.number().int().positive().default(4000),
  })
  .parse(process.env);

const db = createDbFromEnv("app");
const adminDb = createDbFromEnv("admin", { max: 2 });
const app = await buildApp({ db, adminDb, config: apiConfigFromEnv() });

const shutdown = async () => {
  await app.close();
  await Promise.all([db.destroy(), adminDb.destroy()]);
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: env.API_HOST, port: env.API_PORT });
