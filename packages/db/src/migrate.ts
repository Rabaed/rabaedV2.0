import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

// Any constant; serialises concurrent migration runs against one database.
const LOCK_KEY = 718_200_186;

const fileName = /^\d{14}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
}

/**
 * Applies every pending `migrations/*.sql` file in name order, each in its own
 * transaction. Files are named `YYYYMMDDHHMMSS_what.sql` so parallel branches
 * never pick the same name. An applied file must never change.
 */
export async function migrate(migratorUrl: string, dir: string = migrationsDir): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (!fileName.test(f)) throw new Error(`Migration file name must look like 20260928150000_name.sql: ${f}`);
  }

  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      create schema if not exists migrations;
      create table if not exists migrations.applied (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
    `);
    const done = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>("select name, checksum from migrations.applied")).rows.map(
        (r) => [r.name, r.checksum],
      ),
    );

    const applied: string[] = [];
    for (const f of files) {
      const body = await readFile(join(dir, f), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      const previous = done.get(f);
      if (previous !== undefined) {
        if (previous !== checksum) throw new Error(`Migration ${f} was changed after it was applied`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(body);
        await client.query("insert into migrations.applied (name, checksum) values ($1, $2)", [f, checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${f} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(f);
    }
    return { applied };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
