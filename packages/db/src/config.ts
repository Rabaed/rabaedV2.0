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

// api and worker run for weeks, so in AWS they read their passwords from
// Secrets Manager when connecting (see rotating-password.ts) instead of once at start.
const secretVariable = {
  app: "DATABASE_APP_SECRET_ARN",
  admin: "DATABASE_ADMIN_SECRET_ARN",
} as const;

const parts = z.object({
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().min(1),
  /** A CA bundle file: when set, TLS is required and the server's certificate verified. */
  DATABASE_SSL_ROOT_CERT: z.string().min(1).optional(),
  username: z.string().min(1),
});

/** The role's URL from parts; with no password when it is read from a secret instead. */
function urlFromParts(source: NodeJS.ProcessEnv, role: Role, password: string | undefined): string {
  // The superuser (RDS master user) has its own name; the other roles' names are fixed.
  const username = { superuser: source.DATABASE_SUPERUSER_USERNAME, migrator: MIGRATOR_ROLE, app: APP_ROLE, admin: ADMIN_ROLE }[role];
  const p = parts.parse({ ...source, username });
  // The superuser only creates roles and the database, so it connects to the default one.
  const database = role === "superuser" ? "postgres" : p.DATABASE_NAME;
  const credentials = password === undefined ? encodeURIComponent(p.username) : `${encodeURIComponent(p.username)}:${encodeURIComponent(password)}`;
  const url = `postgres://${credentials}@${p.DATABASE_HOST}:${p.DATABASE_PORT}/${database}`;
  if (!p.DATABASE_SSL_ROOT_CERT) return url;
  return `${url}?${new URLSearchParams({ sslmode: "verify-full", sslrootcert: p.DATABASE_SSL_ROOT_CERT })}`;
}

function urlFromEnv(source: NodeJS.ProcessEnv, role: Role): string {
  const whole = source[urlVariable[role]];
  if (whole !== undefined) return z.url().parse(whole);
  const password = z.string().min(1, `${passwordVariable[role]} is required`).parse(source[passwordVariable[role]] ?? "");
  return urlFromParts(source, role, password);
}

export interface Connection {
  url: string;
  /** Secrets Manager secret holding the current password; the URL then has none. */
  passwordSecret?: string;
}

/** How api and worker connect as the app or admin role. */
export function connectionFromEnv(role: keyof typeof secretVariable, source: NodeJS.ProcessEnv = process.env): Connection {
  const passwordSecret = source[secretVariable[role]];
  if (!passwordSecret || source[urlVariable[role]] !== undefined) return { url: urlFromEnv(source, role) };
  return { url: urlFromParts(source, role, undefined), passwordSecret };
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
