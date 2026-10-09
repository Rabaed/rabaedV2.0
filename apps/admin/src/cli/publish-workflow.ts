// Publishes the next Version of a Rabaed Default Workflow, after every publish check.
// Usage: pnpm --filter @rabaed/admin run workflow:publish --type MAR --definition path/to/workflow.json
//          --reason "Why it changes" --engineer you@rabaed.sa
//
// The file holds one Workflow definition document (workflow-engine.md §1 "Definition
// format"). The publish is a Rabaed Engineer action, logged in admin_action with the
// reason (visibility.md V9) against the active Engineer whose Rabaed Admin email
// `--engineer` gives. A refused definition is listed problem by problem, in English,
// and nothing is published or logged; warnings are listed and don't stop it. A
// published Version never changes: new Work Items of the Type, on every Project that
// binds no other Workflow, start on it at once, and items already created keep theirs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { engineerReason, type WorkflowProblem } from "@rabaed/domain";
import { z } from "zod";
import { publishRabaedWorkflowAs } from "../workflows.ts";

const { values } = parseArgs({
  options: { type: { type: "string" }, definition: { type: "string" }, reason: { type: "string" }, engineer: { type: "string" } },
});
const input = z
  .object({ type: z.string().trim().min(1), definition: z.string().min(1), reason: engineerReason, engineer: z.email() })
  .parse(values);
// pnpm runs the script in apps/admin; a relative path is from where it was typed.
const definition: unknown = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), input.definition), "utf8"));

const lines = (items: string[]) => items.map((i) => `  ${i}`).join("\n");
const problemLine = (p: WorkflowProblem) => [p.code, p.step ?? p.transition, p.message.en].filter(Boolean).join(": ");

const db = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
try {
  const result = await publishRabaedWorkflowAs(db, { engineerEmail: input.engineer, typeCode: input.type, definition, reason: input.reason });
  if (result.ok) {
    console.log(`${input.type} Workflow Version ${result.versionNo} published (${result.definitionId}).`);
    if (result.warnings.length > 0) console.log(`Warnings:\n${lines(result.warnings.map(problemLine))}`);
  } else {
    process.exitCode = 1;
    if (result.reason === "engineer_not_found") console.error(`No active Rabaed Engineer ${input.engineer}.`);
    else if (result.reason === "type_not_found") console.error(`No Rabaed Default Work Item Type ${input.type} with a Workflow.`);
    else if (result.reason === "invalid_definition") console.error(`Not a Workflow definition:\n${lines(result.issues.map((i) => `${i.path || "(definition)"}: ${i.message}`))}`);
    else console.error(`Refused, nothing published:\n${lines(result.problems.map(problemLine))}`);
  }
} finally {
  await db.destroy();
}
