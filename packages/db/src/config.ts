import { z } from "zod";

// The roles every Instance runs with. Their names are fixed because
// migrations grant to them by name; only their passwords come from the environment.
export const APP_ROLE = "rabaed_app";
export const MIGRATOR_ROLE = "rabaed_migrator";
export const ADMIN_ROLE = "rabaed_admin";

export interface DatabaseUrls {
  /** A superuser (or RDS master user), used only to create roles and the database. */
  superuser: string;
  /** Owns the schema and runs migrations. */
  migrator: string;
  /** What api and worker connect as. Cannot bypass row-level security. */
  app: string;
  /** Rabaed Admin (Rabaed Engineers): bypasses row-level security; every use writes admin_action. */
  admin: string;
}

const env = z.object({
  DATABASE_SUPERUSER_URL: z.url(),
  DATABASE_MIGRATOR_URL: z.url(),
  DATABASE_APP_URL: z.url(),
  DATABASE_ADMIN_URL: z.url(),
});

export function databaseUrlsFromEnv(source: NodeJS.ProcessEnv = process.env): DatabaseUrls {
  const parsed = env.parse(source);
  return {
    superuser: parsed.DATABASE_SUPERUSER_URL,
    migrator: parsed.DATABASE_MIGRATOR_URL,
    app: parsed.DATABASE_APP_URL,
    admin: parsed.DATABASE_ADMIN_URL,
  };
}

export function appUrlFromEnv(source: NodeJS.ProcessEnv = process.env): string {
  return z.object({ DATABASE_APP_URL: z.url() }).parse(source).DATABASE_APP_URL;
}

export function adminUrlFromEnv(source: NodeJS.ProcessEnv = process.env): string {
  return z.object({ DATABASE_ADMIN_URL: z.url() }).parse(source).DATABASE_ADMIN_URL;
}

/** Same server and roles, another database: used to keep tests off the dev database. */
export function withDatabaseName(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}
