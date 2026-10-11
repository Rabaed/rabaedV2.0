import type { BilingualText } from "@rabaed/domain";
import type { WorkflowLabels } from "./workflow-labels.ts";
import type { WorkflowRuleLabels } from "./workflow-rule-labels.ts";

/**
 * The Workflow builder's words (RP-439, WF-16), in the viewer's language, from the
 * app's messages: the package has no translations of its own. `names` are the
 * names the builder gives what it adds, in both languages, since a Step and a
 * Transition are always named in English and Arabic.
 */
export type WorkflowBuilderLabels = {
  map: WorkflowLabels;
  /** The Transition's rules, actions and notifications (RP-440). */
  rules: WorkflowRuleLabels;
  /** The back link to the Workflows, e.g. "Workflows". */
  back: string;
  /** The draft's badge, e.g. "Draft v4". */
  draft: (version: string) => string;
  /** After the draft's badge: "Saved 14:32", "Saving…", "Unsaved changes", "Couldn't save"; nothing before the first save. */
  saved: (time: string) => string;
  saving: string;
  unsaved: string;
  saveFailed: string;
  undo: string;
  redo: string;
  autoLayout: string;
  testRun: string;
  validate: string;
  publish: string;
  /** The palette: its headings and items. */
  palette: string;
  add: string;
  step: string;
  /** An outcome to add, e.g. "End · Approved". */
  end: (stage: string) => string;
  templates: string;
  templateInternal: string;
  templateConsultant: string;
  /** The side panel. */
  editor: string;
  nothingSelected: string;
  nothingSelectedHint: string;
  thisDraft: string;
  counts: (steps: string, transitions: string) => string;
  stepHeading: string;
  nameEn: string;
  nameAr: string;
  stage: string;
  whoHolds: string;
  role: string;
  permission: string;
  positions: string;
  positionsHelp: string;
  /** Who may hold the Step, naming no one (visibility.md: the builder names no Member), e.g. "Pool: anyone holding Consultant · Review". */
  poolHint: (holders: string) => string;
  /** The raiser's Steps: whether the Member holding it edits the raiser's Form (ADR 0019). */
  editsForm: string;
  editsFormHelp: string;
  outcomeHeading: string;
  outcomeNone: string;
  draftsVisibleTo: string;
  draftsWholeCompany: string;
  draftsAuthorOnly: string;
  draftsVisibleHelp: string;
  addTransitionTo: string;
  addTransitionHelp: string;
  deleteStep: string;
  endHeading: string;
  transitionHeading: (from: string, to: string) => string;
  labelEn: string;
  labelAr: string;
  kind: string;
  outcomeCode: string;
  noOutcome: string;
  /** Why the outcome is off on any kind but Close. */
  outcomeOnlyOnClose: string;
  screen: string;
  screenHelp: string;
  /** A Transition without its own Action Form: only the Internal Note is asked. */
  internalNoteOnly: string;
  /** The Screen picker's choices: none (the Internal Note only), the Transition's own Action Form, a key with no published Screen. */
  screenNone: string;
  screenOwn: string;
  screenMissing: (key: string) => string;
  confirm: string;
  deleteTransition: string;
  /** The validation panel. */
  problemsName: string;
  noErrors: string;
  /** Counts: `count` picks the plural, `n` is it written with Latin digits. */
  errors: (count: number, n: string) => string;
  warnings: (count: number, n: string) => string;
  showProblem: (message: string) => string;
  validationPassed: string;
  errorsToFix: (count: number, n: string) => string;
  /** The test run bar: the sample values the conditions read, and when none of the Step's Transitions is offered with them. */
  sample: string;
  noWayOn: string;
  testRunAt: string;
  finished: (outcome: string) => string;
  restart: string;
  closeTestRun: string;
  /** The publish dialog. */
  publishTitle: (version: string) => string;
  changesSince: (version: string) => string;
  firstVersion: string;
  added: string;
  removed: string;
  changed: string;
  noChanges: string;
  /** After a changed Transition whose rules changed, e.g. "— condition". */
  conditionChanged: string;
  checking: string;
  passed: string;
  errorsBlock: (count: number, n: string) => string;
  showProblems: string;
  /** The change note the Version keeps (RP-555): required. */
  changeNote: string;
  changeNotePlaceholder: string;
  changeNoteRequired: string;
  /** When no item the author sees runs on the Workflow. */
  appliesToNew: (version: string) => string;
  /** How many items the author sees keep the latest Version (`latest`) and older ones (`older`); `next` is the Version publishing makes. */
  keepVersions: (counts: { latest: number; latestN: string; older: number; olderN: string; version: string; next: string }) => string;
  cancel: string;
  publishVersion: (version: string) => string;
  published: (version: string) => string;
  close: string;
  /** The toasts' region, and the button that dismisses one. */
  alertsRegion: string;
  dismiss: string;
  names: {
    /** The Draft Step a blank Workflow starts with, e.g. "Contractor Engineer"; without it, `newStep`. */
    firstStep?: BilingualText;
    newStep: BilingualText;
    newTransition: BilingualText;
    engineerReview: BilingualText;
    pmReview: BilingualText;
    consultantEngineer: BilingualText;
    consultantManager: BilingualText;
    send: BilingualText;
    return: BilingualText;
  };
};

/** The compare dialog's words. */
export type WorkflowCompareLabels = {
  map: WorkflowLabels;
  title: (from: string, to: string) => string;
  version: (version: string) => string;
  /** The legend: "added", "removed", "changed". */
  legendAdded: string;
  legendRemoved: string;
  legendChanged: string;
  /** Before a line of the list: "Added", "Removed", "Changed". */
  added: string;
  removed: string;
  changed: string;
  noChanges: string;
  close: string;
};
