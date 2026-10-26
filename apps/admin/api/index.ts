import { buildAdminApp } from "../src/app.ts";
import { adminAppOptionsFromEnv } from "../src/from-env.ts";
import { fastifyHandler } from "../src/vercel.ts";

// Rabaed Admin as a Vercel Function (ADR 0026); vercel.json sends every path here.
// As src/server.ts (local) but with no listen and no signal handlers: Vercel starts
// and stops the instance. Its own project, the only one holding the rabaed_admin
// password (ADR 0010), behind Vercel's password protection.
export default fastifyHandler(() => buildAdminApp(adminAppOptionsFromEnv()));
