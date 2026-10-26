import { z } from "zod";
import { buildAdminApp } from "./app.ts";
import { adminAppOptionsFromEnv } from "./from-env.ts";

const env = z
  .object({
    ADMIN_HOST: z.string().default("127.0.0.1"),
    ADMIN_PORT: z.coerce.number().int().positive().default(4050),
  })
  .parse(process.env);

const options = adminAppOptionsFromEnv();
const app = await buildAdminApp(options);

const shutdown = async () => {
  await app.close();
  await options.db.destroy();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: env.ADMIN_HOST, port: env.ADMIN_PORT });
