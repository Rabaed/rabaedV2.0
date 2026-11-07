import { backwardKinds, type BilingualText, type WorkItemDetail } from "@rabaed/domain";

/**
 * What the Submittal Panel's action bar offers (RP-1237, gap table v3 rows 22–27 and 48–51), worked
 * out apart from React. It reads only what the item read gives the viewer: exactly what the engine
 * offers them, and who holds it as they may know it (V14). Download PDF is always in the bar and is
 * not part of this.
 */

type Actions = WorkItemDetail["actions"];
export type SubmittalPanelBarTransition = Actions["transitions"][number];

export type SubmittalPanelBarChip =
  /** It waits in the viewer's own Step Pool: how many Members it waits on (row 48). */
  | { kind: "pool"; count: number }
  /** Someone of the viewer's own Company picked it up, and the viewer may do nothing on it (row 51). */
  | { kind: "pickedUp"; name: BilingualText; weeks: number | null }
  /** Nothing offered: another Company holds it, or it is closed (row 26). */
  | { kind: "viewOnly" };

export type SubmittalPanelBar = {
  /** Edit the Form: the Form's holder (row 28). */
  edit: boolean;
  /** Discard this Revision, beside Edit on a Draft Revision (row 27). */
  discardRevision: boolean;
  createRevision: boolean;
  createReplacement: boolean;
  /** Transitions that issue no code, as buttons with the Workflow's labels (row 26). */
  buttons: SubmittalPanelBarTransition[];
  /** "Issue Review Code ▾": the code Transitions, then any other backward Transition below its divider (rows 23, 24). */
  menu: { codes: SubmittalPanelBarTransition[]; others: SubmittalPanelBarTransition[] } | null;
  pickUp: boolean;
  /** Just before the menu (row 49); the engine offers it only while the pool has more than one Member (row 50). */
  returnToPool: boolean;
  chip: SubmittalPanelBarChip | null;
};

export function submittalPanelBar({
  actions,
  codes,
  heldBy,
  stepAgeWeeks,
}: {
  actions: Actions;
  /** The Review Code each offered Transition issues, by its key (`transitionCodes`). */
  codes: Readonly<Record<string, string>>;
  heldBy: WorkItemDetail["heldBy"];
  /** Step Age in weeks while it waits at a Step; null when it doesn't age. */
  stepAgeWeeks: number | null;
}): SubmittalPanelBar {
  const coded = actions.transitions.filter((t) => codes[t.key] !== undefined);
  const uncoded = actions.transitions.filter((t) => codes[t.key] === undefined);
  // With a menu, a backward Transition (a Send Back) sits below its divider; without one, every Transition is a button.
  const menu = coded.length > 0 ? { codes: coded, others: uncoded.filter((t) => backwardKinds.includes(t.kind)) } : null;
  const buttons = menu ? uncoded.filter((t) => !backwardKinds.includes(t.kind)) : uncoded;
  const offered =
    actions.saveAnswers ||
    actions.discardRevision ||
    actions.createRevision ||
    actions.createReplacement ||
    actions.pickUp ||
    actions.returnToPool ||
    actions.transitions.length > 0;
  const pool = heldBy?.pool && heldBy.pool.names.length > 0 ? heldBy.pool.names.length : 0;
  const chip: SubmittalPanelBarChip | null = actions.pickUp && pool > 0
    ? { kind: "pool", count: pool }
    : offered
      ? null
      : heldBy?.memberName
        ? { kind: "pickedUp", name: heldBy.memberName, weeks: stepAgeWeeks }
        : { kind: "viewOnly" };
  return {
    edit: actions.saveAnswers,
    discardRevision: actions.discardRevision,
    createRevision: actions.createRevision,
    createReplacement: actions.createReplacement,
    buttons,
    menu,
    pickUp: actions.pickUp,
    returnToPool: actions.returnToPool,
    chip,
  };
}
