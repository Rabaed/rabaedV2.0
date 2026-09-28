import { bootstrap } from "./bootstrap.ts";
import { databaseUrlsFromEnv } from "./config.ts";
import { migrate } from "./migrate.ts";

const urls = databaseUrlsFromEnv();
await bootstrap(urls);
const { applied } = await migrate(urls.migrator);
console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date");
