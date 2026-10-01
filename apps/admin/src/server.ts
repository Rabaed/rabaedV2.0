import { createDbFromEnv } from "@rabaed/db";
import { mailerFromEnv, type Mailer } from "@rabaed/mailer";
import { z } from "zod";
import { buildAdminApp } from "./app.ts";
import { adminConfigFromEnv } from "./config.ts";

const env = z
  .object({
    ADMIN_HOST: z.string().default("127.0.0.1"),
    ADMIN_PORT: z.coerce.number().int().positive().default(4050),
  })
  .parse(process.env);

// Rabaed Admin connects as rabaed_admin only (ADR 0010).
const db = createDbFromEnv("admin", { max: 4 });
// Built at the first email, so an environment whose sender isn't verified yet still starts.
let mailer: Mailer | undefined;
const lazyMailer: Mailer = { send: (message) => (mailer ??= mailerFromEnv()).send(message) };
const app = await buildAdminApp({ db, config: adminConfigFromEnv(), mailer: lazyMailer });

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: env.ADMIN_HOST, port: env.ADMIN_PORT });
