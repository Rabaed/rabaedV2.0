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

type Role = keyof DatabaseUrls;

// Each role's URL comes either whole (DATABASE_APP_URL, as in .env) or from
// parts: in AWS every password is its own secret, injected as its own
// variable, and the host comes from the database instance.
const urlVariable: Record<Role, string> = {
  superuser: "DATABASE_SUPERUSER_URL",
  migrator: "DATABASE_MIGRATOR_URL",
  app: "DATABASE_APP_URL",
  admin: "DATABASE_ADMIN_URL",
};
const passwordVariable: Record<Role, string> = {
  superuser: "DATABASE_SUPERUSER_PASSWORD",
  migrator: "DATABASE_MIGRATOR_PASSWORD",
  app: "DATABASE_APP_PASSWORD",
  admin: "DATABASE_ADMIN_PASSWORD",
};

const parts = z.object({
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().min(1),
  /** A CA bundle file: when set, TLS is required and the server's certificate verified. */
  DATABASE_SSL_ROOT_CERT: z.string().min(1).optional(),
  password: z.string().min(1),
  username: z.string().min(1),
});

function urlFromEnv(source: NodeJS.ProcessEnv, role: Role): string {
  const whole = source[urlVariable[role]];
  if (whole !== undefined) return z.url().parse(whole);

  // The superuser (RDS master user) has its own name; the other roles' names are fixed.
  const username = { superuser: source.DATABASE_SUPERUSER_USERNAME, migrator: MIGRATOR_ROLE, app: APP_ROLE, admin: ADMIN_ROLE }[role];
  const p = parts.parse({ ...source, username, password: source[passwordVariable[role]] });
  // The superuser only creates roles and the database, so it connects to the default one.
  const database = role === "superuser" ? "postgres" : p.DATABASE_NAME;
  const url = `postgres://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${p.DATABASE_HOST}:${p.DATABASE_PORT}/${database}`;
  if (!p.DATABASE_SSL_ROOT_CERT) return url;
  return `${url}?${new URLSearchParams({ sslmode: "verify-full", sslrootcert: p.DATABASE_SSL_ROOT_CERT })}`;
}

export function databaseUrlsFromEnv(source: NodeJS.ProcessEnv = process.env): DatabaseUrls {
  return {
    superuser: urlFromEnv(source, "superuser"),
    migrator: urlFromEnv(source, "migrator"),
    app: urlFromEnv(source, "app"),
    admin: urlFromEnv(source, "admin"),
  };
}

export function appUrlFromEnv(source: NodeJS.ProcessEnv = process.env): string {
  return urlFromEnv(source, "app");
}

export function adminUrlFromEnv(source: NodeJS.ProcessEnv = process.env): string {
  return urlFromEnv(source, "admin");
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
