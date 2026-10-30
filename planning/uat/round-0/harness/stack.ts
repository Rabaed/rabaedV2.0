import { stackProblems, stoppedMessage, targetOfEnv } from "../../../../scripts/stack-health.ts";
import "./browser.ts";

// RP-1099: the harness writes no result while the lane's api or db is down. browser.ts loads the
// worktree's .env, so API_URL and POSTGRES_PORT are the lane's (lane 7's when unset).

const stack = targetOfEnv(process.env);

/** Why the run must stop now, or undefined when the stack is up. `after` names what it wrote nothing for. */
export async function stackDown(after?: string): Promise<string | undefined> {
  const problems = await stackProblems(stack);
  return problems.length === 0 ? undefined : stoppedMessage(problems, after);
}
