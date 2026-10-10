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
  /** After the draft's badge: "Saved 14:32", "Saving…", "Unsaved changes", "Couldn't save". */
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
  screen: string;
  screenHelp: string;
  /** A Transition without its own Action Form: only the Internal Note is asked. */
  internalNoteOnly: string;
  confirm: string;
  deleteTransition: string;
  /** The validation panel. */
  problemsName: string;
  noErrors: string;
  errors: (count: string) => string;
  warnings: (count: string) => string;
  showProblem: (message: string) => string;
  validationPassed: string;
  errorsToFix: (count: string) => string;
  /** The test run bar. */
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
  checking: string;
  passed: string;
  errorsBlock: (count: string) => string;
  showProblems: string;
  appliesToNew: (version: string) => string;
  cancel: string;
  publishVersion: (version: string) => string;
  published: (version: string) => string;
  close: string;
  names: {
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
