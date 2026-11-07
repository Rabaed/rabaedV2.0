import type { BilingualText, WorkflowDefinition } from "@rabaed/domain";

/**
 * "What happens when you confirm" in the Submittal Panel's Action Form sheet (RP-1237, gap table v3 row 30),
 * worked out apart from React. It reads only the Workflow map the viewer already reads (shown whole, V14) and
 * what the bar knows of the Transition: never a due date, never a "stamp" (a Stamp is a Company's own, GLOSSARY).
 */
export type ActionSheetEffect =
  /** The Stage the item moves to: the Stage of the Step the Transition leads to. */
  | { kind: "stage"; name: BilingualText }
  /** Another Company is told: the raiser of a code, or whoever Submitted it for a Send Back. */
  | { kind: "told"; company: BilingualText }
  /** Code B: how many Comments open in the Snag List, for whom (null: the viewer's own Company). */
  | { kind: "comments"; count: number; company: BilingualText | null }
  /** A code whose outcome offers a Revision (Code C): back to the raiser for a new one. */
  | { kind: "revision"; company: BilingualText | null }
  /** The Review Code is printed on the Documental Record. */
  | { kind: "record"; code: string };

export function actionSheetEffects({
  transitionKey,
  definition,
  stages,
  told,
  code,
  offersRevision,
  comments,
}: {
  transitionKey: string;
  definition: WorkflowDefinition | null;
  stages: readonly { key: string; name: BilingualText }[];
  /** The Company the Transition goes to, when it is another than the viewer's own; null otherwise. */
  told: BilingualText | null;
  /** The Review Code it issues; null for a Transition that issues none. */
  code: string | null;
  offersRevision: boolean;
  /** The Comments its rows will open (Code B); null when its outcome opens none. */
  comments: number | null;
}): ActionSheetEffect[] {
  const effects: ActionSheetEffect[] = [];
  const transition = definition?.transitions.find((t) => t.key === transitionKey);
  const step = transition ? definition?.steps.find((s) => s.key === transition.to) : undefined;
  const stage = step ? stages.find((s) => s.key === step.stage) : undefined;
  if (stage) effects.push({ kind: "stage", name: stage.name });
  if (comments !== null) effects.push({ kind: "comments", count: comments, company: told });
  else if (offersRevision) effects.push({ kind: "revision", company: told });
  else if (told) effects.push({ kind: "told", company: told });
  if (code !== null) effects.push({ kind: "record", code });
  return effects;
}
