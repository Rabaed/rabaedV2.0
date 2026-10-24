import { bootstrap } from "./bootstrap.ts";
import { databaseUrlsFromEnv } from "./config.ts";
import { migrate } from "./migrate.ts";

// The role passwords' mode comes from DATABASE_ROLE_PASSWORDS (bootstrap's default).
const urls = databaseUrlsFromEnv();
await bootstrap(urls);
const { applied } = await migrate(urls.migrator);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date");
