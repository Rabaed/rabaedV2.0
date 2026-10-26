import { createDbFromEnv } from "@rabaed/db";
import { buildApp } from "../src/app.ts";
import { apiConfigFromEnv } from "../src/config.ts";
import { createFileStore, fileStoreSettingsFromEnv } from "../src/documents/file-store.ts";
import { fastifyHandler } from "../src/vercel.ts";

// The api as a Vercel Function (ADR 0026); vercel.json sends every path here.
// Unlike src/server.ts (local): no listen, no outbox report on a timer and no
// signal handlers, since Vercel starts and stops the instance; and the file
// store's bucket is never created from here.
export default fastifyHandler(() => buildApp({ db: createDbFromEnv("app"), config: apiConfigFromEnv(), files: createFileStore(fileStoreSettingsFromEnv()) }));
