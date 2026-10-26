import { createDbFromEnv } from "@rabaed/db";
import { mailerFromEnv, type Mailer } from "@rabaed/mailer";
import type { AdminAppOptions } from "./app.ts";
import { adminConfigFromEnv } from "./config.ts";

/** What Rabaed Admin runs with, from the environment: locally (src/server.ts) and on Vercel (api/index.ts). */
export function adminAppOptionsFromEnv(): AdminAppOptions {
  // Built at the first email, so an environment whose sender isn't verified yet still starts.
  let mailer: Mailer | undefined;
  return {
    // Rabaed Admin connects as rabaed_admin only (ADR 0010).
    db: createDbFromEnv("admin", { max: 4 }),
    config: adminConfigFromEnv(),
    mailer: { send: (message) => (mailer ??= mailerFromEnv()).send(message) },
  };
}
