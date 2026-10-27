import { parseArgs } from "node:util";
import { stepNames, type StepName } from "./verify-steps.ts";

// `pnpm verify`'s flags (RP-1019). `--from <step>` resumes at a named step after a late failure, instead of
// running every step before it again; `--log <file>` sends the whole output to a file and prints only the
// final line, so a background run reports verify's own result and exit code (a pipe through tail or grep
// hid both, RP-631).

export type VerifyOptions = { ok: true; from?: StepName; log?: string } | { ok: false; message: string };

const usage = "Usage: pnpm verify [--from <step>] [--log <file>]";
const valid = `Valid steps: ${stepNames.join(", ")}.`;

/** The step `name` names: its pnpm script (`test:seam1`), or that without its `test:`/`check:` prefix (`seam1`). */
const stepNamed = (name: string) => stepNames.find((step) => step === name || step.slice(step.indexOf(":") + 1) === name);

/** The options in `argv` (the arguments after `pnpm verify`), or the message to stop with. */
export function verifyOptions(argv: string[]): VerifyOptions {
  let values: { from?: string; log?: string };
  try {
    ({ values } = parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options: { from: { type: "string" }, log: { type: "string" } }, strict: true, allowPositionals: false }));
  } catch (error) {
    return { ok: false, message: `pnpm verify: ${error instanceof Error ? error.message : String(error)}\n${usage}\n${valid}` };
  }
  const options: VerifyOptions = { ok: true };
  if (values.log !== undefined) options.log = values.log;
  if (values.from !== undefined) {
    const from = stepNamed(values.from);
    if (!from) return { ok: false, message: `pnpm verify --from: no step "${values.from}". ${valid}` };
    options.from = from;
  }
  return options;
}
