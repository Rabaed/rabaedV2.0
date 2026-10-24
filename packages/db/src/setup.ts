import { bootstrap } from "./bootstrap.ts";
import { databaseUrlsFromEnv, rolePasswordsFromEnv } from "./config.ts";
import { migrate } from "./migrate.ts";

// The AWS migration task sets it to on-create: rotation owns the passwords there.
const passwords = rolePasswordsFromEnv();

const urls = databaseUrlsFromEnv();
await bootstrap(urls, { passwords });
const { applied } = await migrate(urls.migrator);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date");
