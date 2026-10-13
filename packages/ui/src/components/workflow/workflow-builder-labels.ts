import type { BilingualText, OutcomeMode } from "@rabaed/domain";
import type { WorkflowLabels } from "./workflow-labels.ts";
import type { WorkflowRuleLabels } from "./workflow-rule-labels.ts";

/** What a Screen field asks, as a block of the Action Form's read-only summary. */
export type ActionFieldKind = "text" | "choice" | "yesNo" | "number" | "date" | "table" | "files" | "other";

/** What changed on a changed Transition or Step, in the publish dialog's list. */
export type ChangedPart = "condition" | "kind" | "screen" | "notifications" | "outcome" | "label" | "stage" | "holder" | "name";

/**
 * The Workflow builder's words (RP-439, WF-16; RP-555's V2), in the viewer's language,
 * from the app's messages: the package has no translations of its own. `names` are the
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
  /** The badge once the draft is published, until the next edit, e.g. "Published v4". */
  publishedBadge: (version: string) => string;
  /** After the draft's badge: "Saved 14:32", "Saving…", "Unsaved changes", "Couldn't save"; nothing before the first save. */
  saved: (time: string) => string;
  saving: string;
  unsaved: string;
  saveFailed: string;
  /** The arrows' style switch: its name, and its two choices. */
  arrowStyle: string;
  curved: string;
  orthogonal: string;
  undo: string;
  redo: string;
  autoLayout: string;
  testRun: string;
  validate: string;
  publish: string;
  /** The palette: its name, headings and items. */
  palette: string;
  /** The palette's first heading, e.g. "Drag to add". */
  add: string;
  /** A palette item's hint, e.g. "Drag onto the canvas, or click to add". */
  dragHint: string;
  step: string;
  /** An outcome to add, e.g. "End · Approved". */
  end: (stage: string) => string;
  templates: string;
  templateInternal: string;
  templateConsultant: string;
  /** The palette's Canvas switches (each viewer's own). */
  canvasHeading: string;
  snapToGrid: string;
  minimap: string;
  /** The side panel. */
  editor: string;
  nothingSelected: string;
  nothingSelectedHint: string;
  /** "On the canvas": how to work the canvas. */
  tipsHeading: string;
  tipConnect: string;
  tipPalette: string;
  tipBoxSelect: string;
  /** The keys' tip: "Delete removes the selection · ⌘Z undo · ⇧⌘Z redo". */
  tipDelete: string;
  tipUndo: string;
  tipRedo: string;
  thisDraft: string;
  /** "6 Steps · 15 Transitions": `steps` and `transitions` pick the plurals, the `…N` are them written. */
  counts: (counts: { steps: number; stepsN: string; transitions: number; transitionsN: string }) => string;
  /** Several selected together (Shift-drag): "3 selected"; and what the keys do with them. */
  groupSelected: (count: number, n: string) => string;
  groupHint: string;
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
  /** The Step's Outcome choices, e.g. "Recommend a code (for the manager)". */
  outcomeOption: (mode: OutcomeMode) => string;
  draftsVisibleTo: string;
  draftsWholeCompany: string;
  draftsAuthorOnly: string;
  draftsVisibleHelp: string;
  /** "Transitions from this Step · 3". */
  transitionsFrom: (n: string) => string;
  /** A Step with no way out: how to add one. */
  deadEndHint: string;
  addTransitionTo: string;
  addTransitionPlaceholder: string;
  addTransitionHelp: string;
  deleteStep: string;
  endHeading: string;
  endHint: string;
  /** "Incoming · 4". */
  incoming: (n: string) => string;
  deleteEnd: string;
  transitionHeading: string;
  labelEn: string;
  labelAr: string;
  kind: string;
  outcomeCode: string;
  /** The Outcome's name on a Type whose outcomes are Review Codes, e.g. "Outcome · Review Code". */
  outcomeReviewCode: string;
  noOutcome: string;
  /** Why the outcome is off on any kind but Close. */
  outcomeOnlyOnClose: string;
  /** The Action Form section: its heading and the Screen picker. */
  actionFormHeading: string;
  screen: string;
  screenHelp: string;
  /** A Transition without its own Action Form: only the Internal Note is asked. */
  internalNoteOnly: string;
  /** The Screen picker's choices: none (the Internal Note only), the Transition's own Action Form, a key with no published Screen. */
  screenNone: string;
  screenOwn: string;
  screenMissing: (key: string) => string;
  /** The read-only blocks of the chosen Screen: the Internal Note always, then each field. */
  internalNote: string;
  internalNoteBlock: string;
  fieldKind: (kind: ActionFieldKind) => string;
  required: string;
  optional: string;
  /** Under a Screen's table of items to create; with the outcome's Type, "Each row becomes a Comment in the Snag List". */
  createsItems: string;
  createsItemsOf: (type: string) => string;
  /** A table's add-row button in the plain pop-up (Rabaed Admin). */
  addRow: string;
  /** The pop-up's Recommended Code, on a Transition from a Step that recommends a code. */
  recommendCode: string;
  recommendCodeHelp: string;
  /** An outcome creating items, and a Screen without the table to list them. */
  itemsTableMissing: string;
  editInScreens: string;
  previewPopup: string;
  confirm: string;
  deleteTransition: string;
  /** The pop-up: as the holder sees it (a preview), or in a test run. */
  popupPreview: (route: string) => string;
  popupTestRun: (route: string) => string;
  /** "Code A". */
  codeChip: (code: string) => string;
  /** The footer while required fields are empty: "Required: Remarks, Reason". */
  requiredMissing: (names: string) => string;
  skip: string;
  previewOnly: string;
  testRecorded: string;
  /** A test run's Transition whose Screen creates items: what it would create, nothing being created. */
  testWouldCreate: (count: number, n: string) => string;
  /** The same, naming the Type its rows become: "Would create 2 items (Comment) in the Snag List". */
  testWouldCreateOf: (count: number, n: string, type: string) => string;
  /** Toasts on the canvas. */
  addedTransition: (name: string) => string;
  endsCannotStart: string;
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
  /** After a changed line, what changed, e.g. "condition". */
  changedPart: (part: ChangedPart) => string;
  checking: string;
  passed: string;
  errorsBlock: (count: number, n: string) => string;
  showFirstError: string;
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
  /** The published toast's link to the Workflow's Versions. */
  viewVersions: string;
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
    /** A new Transition is named by its kind (RP-555): "Send", "Submit", "Return", "Cancel"; a Close by the End it goes to. */
    send: BilingualText;
    submit: BilingualText;
    return: BilingualText;
    cancel: BilingualText;
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
