// The [y/N] prompt the clean-up scripts (lanes:prune, lanes:drop-dbs,
// worktrees:clean) ask before they delete anything.
import { createInterface } from "node:readline/promises";

/** Whether an answer to a [y/N] prompt is yes. */
export const isYes = (answer: string) => /^y(es)?$/i.test(answer.trim());

/**
 * Asks `question` [y/N] and exits unless the answer is yes; `yes` (the --yes flag)
 * skips the prompt. Without a terminal it never deletes: it exits and says to
 * re-run with --yes. `verb` and `done` name the action, e.g. "drop" and "dropped".
 */
export async function confirmOrExit(question: string, { yes, verb, done }: { yes: boolean; verb: string; done: string }): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY) {
    console.error(`Not ${done}: re-run with --yes to ${verb} them without a prompt.`);
    process.exit(1);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`${question} [y/N] `);
  prompt.close();
  if (!isYes(answer)) {
    console.log(`Nothing ${done}.`);
    process.exit(0);
  }
}
