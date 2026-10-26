import { createDbFromEnv } from "@rabaed/db";
import { mailerFromEnv, type Mailer } from "@rabaed/mailer";
import { buildAdminApp } from "../src/app.ts";
import { adminConfigFromEnv } from "../src/config.ts";
import { fastifyHandler } from "../src/vercel.ts";

// Rabaed Admin as a Vercel Function (ADR 0026); vercel.json sends every path here.
// As src/server.ts (local) but with no listen and no signal handlers: Vercel starts
// and stops the instance. Its own project, the only one holding the rabaed_admin
// password (ADR 0010), behind Vercel's password protection.
export default fastifyHandler(() => {
  // Built at the first email, so an environment whose sender isn't verified yet still starts.
  let mailer: Mailer | undefined;
  const lazyMailer: Mailer = { send: (message) => (mailer ??= mailerFromEnv()).send(message) };
  return buildAdminApp({ db: createDbFromEnv("admin", { max: 4 }), config: adminConfigFromEnv(), mailer: lazyMailer });
});
