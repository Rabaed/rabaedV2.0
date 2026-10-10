import type { BaseRole, FunctionPermission, OutcomeMode, TransitionKind } from "@rabaed/domain";

/**
 * The Workflow canvas's and Step list's words, in the viewer's language, from the
 * app's messages: the package has no translations of its own.
 */
export type WorkflowLabels = {
  /** The canvas region's name, e.g. "Workflow map". */
  canvas: string;
  /** The Step list's name, e.g. "Steps and Transitions". */
  list: string;
  /** The band of the terminal Steps, e.g. "Outcome". */
  outcome: string;
  /** A Participant role, e.g. "Consultant". */
  role: (role: BaseRole) => string;
  /** A Function Permission, e.g. "Approve". */
  permission: (permission: FunctionPermission) => string;
  /** What a Step does about the outcome, e.g. "Issues the final code"; not called for `none`. */
  outcomeMode: (mode: Exclude<OutcomeMode, "none">) => string;
  /** A Transition's kind, e.g. "Return". */
  kind: (kind: TransitionKind) => string;
  /** A Position, by its key; the key itself when left out. */
  position?: (key: string) => string;
  /** Another Participant's folded part, e.g. "Consultant review". */
  part: (role: string) => string;
  /** The part holding the item, e.g. "With Design Consultants LLC". */
  withCompany: (company: string) => string;
  /** Marks where the item is, e.g. "Current". */
  current: string;
  /** Before a Transition's target in the list, e.g. "to". */
  to: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
};
