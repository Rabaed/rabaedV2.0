// Publishes the next Version of a Rabaed Default Form, after the publish-time checks.
// Usage: pnpm form:publish --type MAR --schema path/to/schema.json
//
// The schema file holds {"sections": [...]} (form-engine.md §1). A refused schema
// is listed problem by problem and nothing is published; a published Version
// never changes, so new Work Items pin it and older ones keep theirs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { z } from "zod";
import { publishFormVersion, rabaedDefaultFormId } from "../forms.ts";

const { values } = parseArgs({ options: { type: { type: "string" }, schema: { type: "string" } } });
const input = z.object({ type: z.string().trim().min(1), schema: z.string().min(1) }).parse(values);
// pnpm runs the script in apps/admin; a relative path is from where it was typed.
const schema: unknown = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), input.schema), "utf8"));

const db = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
try {
  const formId = await rabaedDefaultFormId(db, input.type);
  const result = formId ? await publishFormVersion(db, formId, schema) : null;
  const lines = (items: string[]) => items.map((i) => `  ${i}`).join("\n");
  if (result?.ok) {
    console.log(`${input.type} Form Version ${result.versionNo} published (${result.id}).`);
  } else {
    process.exitCode = 1;
    if (!result || result.reason === "form_not_found") console.error(`No Rabaed Default Work Item Type ${input.type} with a Form.`);
    else if (result.reason === "invalid_schema") console.error(`Not a Form schema:\n${lines(result.issues)}`);
    else console.error(`Refused, nothing published:\n${lines(result.problems.map((p) => `${p.key}: ${p.code}`))}`);
  }
} finally {
  await db.destroy();
}
