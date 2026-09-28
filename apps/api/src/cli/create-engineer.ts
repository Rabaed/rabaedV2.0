// Creates a Rabaed Engineer and prints a generated password once.
// Usage: pnpm engineer:create --email someone@example.com --name "Full Name"
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { z } from "zod";
import { createEngineer } from "../identity/engineers.ts";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const input = z.object({ email: z.email(), name: z.string().trim().min(1) }).parse(values);

const db = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
try {
  const password = randomBytes(18).toString("base64url");
  const id = await createEngineer(db, { email: input.email, fullName: input.name, password });
  console.log(`Rabaed Engineer ${input.email} created (${id}).`);
  console.log(`Password (shown once; keep it in a password manager): ${password}`);
} finally {
  await db.destroy();
}
