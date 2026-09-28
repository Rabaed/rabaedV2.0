import { appUrlFromEnv, createDb } from "@rabaed/db";
import { z } from "zod";
import { buildApp, type Authenticate } from "./app.ts";

const env = z
  .object({
    API_HOST: z.string().default("127.0.0.1"),
    API_PORT: z.coerce.number().int().positive().default(4000),
  })
  .parse(process.env);

// No sign-in yet (RP-187): every request is anonymous.
const noSession: Authenticate = async () => null;

const db = createDb(appUrlFromEnv());
const app = await buildApp({ db, authenticate: noSession });

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: env.API_HOST, port: env.API_PORT });
