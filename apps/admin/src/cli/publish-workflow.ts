// Publishes the next Version of a Rabaed Default Workflow, after every publish check.
// Usage: pnpm workflow:publish --type MAR path/to/workflow.json
//
// The file holds one Workflow definition document (workflow-engine.md §1 "Definition
// format"). A refused definition is listed problem by problem, in English, and nothing
// is published; warnings are listed and don't stop it. A published Version never
// changes: new Work Items of the Type, on every Project that binds no other Workflow,
// start on it at once, and items already created keep theirs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDb, databaseUrlsFromEnv, writeRabaedDefaultWorkflow } from "@rabaed/db";
import type { WorkflowProblem } from "@rabaed/domain";
import { z } from "zod";

const { values, positionals } = parseArgs({ options: { type: { type: "string" } }, allowPositionals: true });
const input = z.object({ type: z.string().trim().min(1), file: z.string().min(1) }).parse({ type: values.type, file: positionals[0] });
// pnpm runs the script in apps/admin; a relative path is from where it was typed.
const definition: unknown = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), input.file), "utf8"));

const lines = (items: string[]) => items.map((i) => `  ${i}`).join("\n");
const problemLine = (p: WorkflowProblem) => [p.code, p.step ?? p.transition, p.message.en].filter(Boolean).join(": ");

const db = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
try {
  const result = await db.transaction().execute((trx) => writeRabaedDefaultWorkflow(trx, input.type, definition, { publish: true }));
  if (result.ok) {
    console.log(`${input.type} Workflow Version ${result.versionNo} published (${result.definitionId}).`);
    if (result.warnings.length > 0) console.log(`Warnings:\n${lines(result.warnings.map(problemLine))}`);
  } else {
    process.exitCode = 1;
    if (result.reason === "type_not_found") console.error(`No Rabaed Default Work Item Type ${input.type} with a Workflow.`);
    else if (result.reason === "invalid_definition") console.error(`Not a Workflow definition:\n${lines(result.issues.map((i) => `${i.path || "(definition)"}: ${i.message}`))}`);
    else console.error(`Refused, nothing published:\n${lines(result.problems.map(problemLine))}`);
  }
} finally {
  await db.destroy();
}
