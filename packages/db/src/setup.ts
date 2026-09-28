import { z } from "zod";
import { bootstrap } from "./bootstrap.ts";
import { databaseUrlsFromEnv } from "./config.ts";
import { migrate } from "./migrate.ts";

// The AWS migration task sets DATABASE_ROLE_PASSWORDS=on-create: rotation owns the passwords there.
const { DATABASE_ROLE_PASSWORDS: passwords } = z
  .object({ DATABASE_ROLE_PASSWORDS: z.enum(["always", "on-create"]).default("always") })
  .parse(process.env);

const urls = databaseUrlsFromEnv();
await bootstrap(urls, { passwords });
const { applied } = await migrate(urls.migrator);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date");
