import type { Db } from "@rabaed/db";
import { hashPassword } from "@rabaed/auth";

/**
 * Creates a Rabaed Engineer (never a Member) with a password. An operations
 * step, run with the migrator connection by the `engineer:create` script.
 */
export async function createEngineer(
  migratorDb: Db,
  input: { email: string; fullName: string; password: string },
): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  return migratorDb.transaction().execute(async (trx) => {
    const engineer = await trx
      .insertInto("rabaed_engineer")
      .values({ email: input.email.trim().toLowerCase(), full_name: input.fullName })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx.insertInto("credential").values({ engineer_id: engineer.id, password_hash: passwordHash }).execute();
    return engineer.id;
  });
}
