import { z } from "zod";
import { bootstrap } from "./bootstrap.ts";
import { databaseUrlsFromEnv } from "./config.ts";
import { migrate } from "./migrate.ts";
import { ROLE_PASSWORDS_FLAG, rolePasswordModes } from "./task-flags.ts";

// The AWS migration task sets it to on-create: rotation owns the passwords there.
const { [ROLE_PASSWORDS_FLAG]: passwords } = z
  .object({ [ROLE_PASSWORDS_FLAG]: z.enum(rolePasswordModes).default("always") })
  .parse(process.env);

const urls = databaseUrlsFromEnv();
await bootstrap(urls, { passwords });
const { applied } = await migrate(urls.migrator);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date");
