import type { ConditionOp, RuleGroup, RuleKind } from "@rabaed/domain";

/**
 * The words of the builder's rules and notifications (RP-440, WF-17), in the
 * viewer's language, from the app's messages: the package has no translations of
 * its own.
 */
export type WorkflowRuleLabels = {
  /** The Transition's rules section, as the design heads it. */
  heading: string;
  addRule: string;
  noRules: string;
  /** Between two Restrict rules, which all must hold. */
  and: string;
  edit: (summary: string) => string;
  remove: (summary: string) => string;

  /** The Transition's two tabs: its settings and its notifications. */
  tabsName: string;
  tabSettings: string;
  tabNotifications: string;

  /** The "Add rule" dialog. */
  addTitle: (transition: string) => string;
  editTitle: (transition: string) => string;
  chooseKind: string;
  next: string;
  back: string;
  add: string;
  save: string;
  cancel: string;
  close: string;
  /** The title and one line for each group and each kind of rule. */
  groupTitle: (group: RuleGroup) => string;
  groupHelp: (group: RuleGroup) => string;
  kindTitle: (kind: RuleKind) => string;
  kindHelp: (kind: RuleKind) => string;
  /** Shown on a kind that can't start: a field rule on a Type whose Form has no fields. */
  noFields: string;

  /** The editors. */
  field: string;
  operator: string;
  value: string;
  yes: string;
  no: string;
  op: (op: ConditionOp) => string;
  /** A field a rule names that the Form doesn't have: shown so it can be changed. */
  missingField: (key: string) => string;
  positions: string;
  positionsHelp: string;
  noPositions: string;
  notSamePersonOf: string;
  heldStep: string;
  tookTransition: string;
  step: string;
  transition: string;
  beenThroughOf: string;
  ownStep: string;
  fact: string;
  sharedFact: (fact: "sent_back" | "revision") => string;
  items: string;
  itemsKind: (items: "comments" | "subtasks") => string;
  messageHeading: string;
  messageEn: string;
  messageAr: string;
  messageHelp: string;
  documentField: string;
  anyDocument: string;
  documentHelp: string;
  setValue: string;
  setNow: string;
  copyFrom: string;
  copyTo: string;
  assignHelp: string;

  /** The condition builder. */
  conditionKind: string;
  conditionKindName: (kind: "comparison" | "all" | "any" | "not") => string;
  conditionKindHelp: (kind: "all" | "any" | "not") => string;
  editCondition: string;
  addCondition: string;
  addGroup: string;
  removeCondition: string;
  emptyGroup: string;
  attribute: (name: string) => string;

  /** One line saying what a rule does, for the list and its buttons. */
  summaryCondition: (field: string, op: string, value: string) => string;
  summaryAll: (parts: string) => string;
  summaryAny: (parts: string) => string;
  summaryNot: (part: string) => string;
  summaryPositions: (names: string) => string;
  summaryNotSameStep: (step: string) => string;
  summaryNotSameTransition: (transition: string) => string;
  summaryBeenStep: (step: string) => string;
  summaryFact: (fact: "sent_back" | "revision") => string;
  summaryAllClosed: (items: "comments" | "subtasks") => string;
  /** "At least one Document", in the named field or, with null, anywhere on the item. */
  summaryDocument: (field: string | null) => string;
  summaryMessage: (message: string) => string;
  summarySet: (field: string, value: string) => string;
  summarySetNow: (field: string) => string;
  summaryCopy: (from: string, to: string) => string;

  /** The Notifications tab. */
  notificationsHeading: string;
  notificationsHelp: string;
  recipients: string;
  holder: string;
  holderAlways: string;
  raiser: string;
  watchers: string;
  positionsOfActing: string;
  noActingPositions: string;
  channels: string;
  inApp: string;
  inAppHelp: string;
  email: string;
  emailHelp: string;
  sms: string;
  smsHelp: string;
};
