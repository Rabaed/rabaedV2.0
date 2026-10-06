import { z } from "zod";
import { bilingualText } from "./company.ts";
import { formAnswers, formSchema, namedAnswers } from "./form.ts";

/** A Work Item Type's short code, used in filters and Document Numbers (MAR, SAR…). */
export const workItemTypeCode = z.string().regex(/^[A-Z]{2,6}$/);

/**
 * A Contractor Member creates a Work Item in Draft: its Subject (`title` in code)
 * and the answers to its Form so far, checked in draft mode against the latest
 * published Form Version of its Type. The Built-in Fields are answers too: `trade`
 * (required even in a Draft), `location` and `scopes` (form-engine.md §1).
 */
export const createWorkItemRequest = z.object({
  type: workItemTypeCode,
  title: z.string().trim().min(1).max(200),
  answers: formAnswers.default({}),
});
export type CreateWorkItemRequest = z.input<typeof createWorkItemRequest>;

export const createdWorkItem = z.object({ id: z.uuid() });

/** Save draft: the Draft's answers so far, checked in draft mode (types, not required). */
export const saveAnswersRequest = z.object({
  answers: formAnswers,
  /**
   * The per-field times (`fieldTimes` of the item, or of the last save) these answers
   * were based on. When given, a field another Member changed since is kept as theirs
   * and the response says so (form-engine.md §8, part 3); without it the save simply replaces.
   */
  basedOn: z.record(z.string(), z.iso.datetime()).optional(),
});
export type SaveAnswersRequest = z.infer<typeof saveAnswersRequest>;

/** When a field was last changed, and by whom: the name only within the viewer's own Company (V14). */
export const fieldTime = z.object({ at: z.iso.datetime(), memberName: bilingualText.nullable(), byMe: z.boolean() });
export type FieldTime = z.infer<typeof fieldTime>;

/**
 * The response to a save that sent `basedOn`: every field's time now, and the fields
 * the save kept as another Member's, with their values.
 */
export const savedAnswers = z.object({
  fieldTimes: z.record(z.string(), fieldTime),
  keptFromOthers: z.array(z.object({ field: z.string(), value: z.unknown(), at: z.iso.datetime(), memberName: bilingualText.nullable() })),
});
export type SavedAnswers = z.infer<typeof savedAnswers>;

// Answers that fail the Form's checks are refused with `{ error, fields }`:
// `invalid_answers` on create and Save draft (draft mode), `form_incomplete` on
// leaving Draft (complete mode); `fields` holds one FieldError per field, in Form order.

export const stageCategories = ["draft", "in_progress", "closed_positive", "closed_negative", "cancelled"] as const;

/** Whether a Stage category is one an item still moves through (not closed or cancelled). */
export const isOpenStageCategory = (category: (typeof stageCategories)[number]) =>
  category === "draft" || category === "in_progress";

const stage = z.object({ key: z.string(), name: bilingualText, category: z.enum(stageCategories) });

/** A Trade or Location as a Work Item shows it. */
const dimensionValueRef = z.object({ id: z.uuid(), code: z.string(), name: bilingualText });

/** A Work Item as a list row. */
export const workItemSummary = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  type: z.object({ code: z.string(), name: bilingualText }),
  title: z.string(),
  /** Null while Draft. */
  documentNumber: z.string().nullable(),
  stage,
  trade: dimensionValueRef,
  location: dimensionValueRef.nullable(),
  stepEnteredAt: z.iso.datetime(),
  /** Step Age: the week it is in at its current Step, 1, 2, 3… (never a due date). */
  stepAgeWeeks: z.number().int().positive(),
});
export type WorkItemSummary = z.infer<typeof workItemSummary>;

/** How a closed Work Item ended: its Issued Code, Inspection result, or cancelled (workflow-engine.md §1). */
export const workItemOutcomes = ["A", "B", "C", "D", "passed", "passed_with_comments", "failed", "cancelled", "closed"] as const;
export const workItemOutcome = z.enum(workItemOutcomes);
export type WorkItemOutcome = z.infer<typeof workItemOutcome>;

/**
 * Who an open item is with, as the viewer may read it (V14): `own` when the
 * viewer's own Participant holds it, with the Step and who claimed it (null
 * while unclaimed); `company` when another Company holds it, by its name only.
 */
export const workItemWith = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("own"),
    companyName: bilingualText,
    step: z.object({ key: z.string(), name: bilingualText }),
    claimer: z.object({ name: bilingualText, isMe: z.boolean() }).nullable(),
  }),
  z.object({ kind: z.literal("company"), companyName: bilingualText }),
]);
export type WorkItemWith = z.infer<typeof workItemWith>;

/** A List row: one Revision the viewer sees, by default the latest of its chain. */
export const workItemRow = workItemSummary.extend({
  /** 0 for the first submission, then 1, 2… */
  revisionNo: z.number().int().nonnegative(),
  /** The Review Code or Inspection Result, once closed. */
  outcome: workItemOutcome.nullable(),
  /** Null once closed: nobody holds it. */
  with: workItemWith.nullable(),
  /** When it was first Submitted: for everyone who sees it. Null while it has not been. */
  submissionDate: z.iso.datetime().nullable(),
  /** Only for a Member of the raiser's Participant (visibility.md "Creation Date"); null for everyone else. Never the time the Draft was started. */
  creationDate: z.iso.datetime().nullable(),
});
export type WorkItemRow = z.infer<typeof workItemRow>;

/**
 * One page of a Project's Work Items the viewer can see, matching the work item
 * query, and every Stage with how many of the matching items are in it. Counts
 * come from the same filtered, visible items, never from all, so they add up
 * to every page's rows together. `nextCursor` is null on the last page.
 * `filters` are what the toolbar offers: the Module's Types, the Project's
 * Trades and Locations, and the "With" values of the viewer's visible items.
 */
export const workItemList = z.object({
  stages: z.array(stage.extend({ count: z.number().int().nonnegative() })),
  items: z.array(workItemRow),
  nextCursor: z.string().nullable(),
  filters: z.object({
    types: z.array(z.object({ code: z.string(), name: bilingualText })),
    trades: z.array(dimensionValueRef),
    locations: z.array(dimensionValueRef.extend({ parentId: z.uuid().nullable() })),
    with: z.object({
      steps: z.array(z.object({ key: z.string(), name: bilingualText })),
      companies: z.array(z.object({ participantId: z.uuid(), name: bilingualText })),
    }),
  }),
});
export type WorkItemList = z.infer<typeof workItemList>;

/**
 * Link search (form-engine.md part 2b; visibility.md "Link search"): part of a
 * Document Number or Subject, matched case-insensitively, and the page wanted.
 * A page holds at most `linkSearchPageMax` items.
 */
export const linkSearchPageMax = 20;
export const linkSearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(linkSearchPageMax).default(linkSearchPageMax),
});
export type LinkSearchQuery = z.infer<typeof linkSearchQuery>;

/** A Work Item that can be linked, in the Link shape: its id, Document Number and Subject. */
export const linkTarget = z.object({ id: z.uuid(), documentNumber: z.string(), subject: z.string() });
export type LinkTarget = z.infer<typeof linkTarget>;

/**
 * One page of Link search: only items the searcher sees that have been
 * Submitted, in the same Project. `nextPage` is null on the last page; there is
 * no total, so nothing hints at matches the searcher can't see.
 */
export const linkSearchResults = z.object({ links: z.array(linkTarget), nextPage: z.number().int().positive().nullable() });
export type LinkSearchResults = z.infer<typeof linkSearchResults>;

/**
 * How a Link was made: `related` freely in the Links System Field, `relies_on`
 * by a link question (its field key says which), `raised_from` by the Snag List.
 */
export const linkKinds = ["related", "relies_on", "raised_from"] as const;
export type LinkKind = (typeof linkKinds)[number];

/**
 * One Link of a Work Item, as its viewer may read it (visibility.md E1): the
 * linked item's Document Number and Subject always, and its id only when the
 * viewer can see it. A hidden item's id never reaches the viewer, so opening it
 * can only say they may not see its details.
 */
export const workItemLink = z.object({
  /** The Link's own id, to remove it by. */
  id: z.uuid(),
  kind: z.enum(linkKinds),
  /** For `relies_on`: the link question that made it. */
  fieldKey: z.string().nullable(),
  documentNumber: z.string(),
  subject: z.string(),
  /** The linked item's id, only when the viewer can see it; null otherwise. */
  workItemId: z.uuid().nullable(),
});
export type WorkItemLink = z.infer<typeof workItemLink>;

/**
 * A Work Item's Links, oldest first, and whether the viewer may add and remove
 * its free Links now: the raiser's Company, until Submit (as Save draft).
 */
export const workItemLinks = z.object({ links: z.array(workItemLink), canChange: z.boolean() });
export type WorkItemLinks = z.infer<typeof workItemLinks>;

/**
 * Add a free Link to an item found with Link search. Anything Link search
 * couldn't have offered is refused like a made-up id (`target_not_found`).
 */
export const addLinkRequest = z.object({ workItemId: z.uuid() });
export type AddLinkRequest = z.infer<typeof addLinkRequest>;

export const addedLink = z.object({ id: z.uuid() });

/**
 * The field an answers_changed event names for a change to the free Links: the
 * Links System Field. No Form field key starts with `$`. Its old and new values
 * are the free Links as Document Number and Subject, never an id.
 */
export const linksChangeField = "$links";
export const linksChangeValue = z.array(z.object({ documentNumber: z.string(), subject: z.string() }));

/**
 * One Submitted item that links to a Work Item, as the viewer may read it
 * (visibility.md E3): its Document Number and Subject always, its id only when
 * the viewer can see it. Nothing else about a hidden one ever reaches them.
 */
export const linkedFromItem = z.object({
  documentNumber: z.string(),
  subject: z.string(),
  /** The linking item's id, only when the viewer can see it; null otherwise. */
  workItemId: z.uuid().nullable(),
});
export type LinkedFromItem = z.infer<typeof linkedFromItem>;

/**
 * The Revision drop-down (workflow-engine.md §5.4; visibility.md the Revisions
 * channel): the Revisions of an item's chain the viewer may see, each by V1 on
 * its own, the original first. A Draft Revision appears only within the
 * raiser's Company, and a discarded one never.
 */
export const revisionChain = z.object({
  revisions: z.array(
    z.object({
      id: z.uuid(),
      /** Its Document Number, a Revision's with its " Rev n"; null until it first leaves Draft. */
      documentNumber: z.string().nullable(),
      /** 0 for the original, then 1, 2… */
      revisionNo: z.number().int().nonnegative(),
    }),
  ),
});
export type RevisionChain = z.infer<typeof revisionChain>;

/** "Linked from": every Submitted item linking to a Work Item, by Document Number. Never a Draft or internal item. */
export const linkedFrom = z.object({ items: z.array(linkedFromItem) });
export type LinkedFrom = z.infer<typeof linkedFrom>;


/** A Transition's kind (workflow-engine.md §1; `send_back` ADR 0014). */
export const transitionKinds = ["send", "submit", "return", "send_back", "close", "cancel"] as const;
export type TransitionKind = (typeof transitionKinds)[number];
/** The kinds that take an item back, within its Participant (`return`) or to the one that Submitted it (`send_back`). */
export const backwardKinds: readonly TransitionKind[] = ["return", "send_back"];

/**
 * The holder of the current Step takes one of its Transitions. The key makes a
 * repeated request (a double-click, a retry) apply only once.
 */
export const takeTransitionRequest = z.object({
  transition: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /**
   * The answers to the Transition's Action Form, by field key, checked against
   * its schema in complete mode (a Return's `reason` is one). Refused with
   * `invalid_action_form` and one FieldError per field.
   */
  answers: formAnswers.default({}),
  /**
   * Optional on any Transition. Seen only by the writer's own Participant, even
   * when the Transition goes to another, such as Submit (visibility.md V5).
   */
  internalNote: z.string().trim().max(4000).default(""),
  idempotencyKey: z.uuid(),
});
export type TakeTransitionRequest = z.input<typeof takeTransitionRequest>;

/**
 * Create a Revision of a closed item (workflow-engine.md §5.4). The key makes a
 * repeated request apply only once, answering with the same Revision.
 */
export const createRevisionRequest = z.object({ idempotencyKey: z.uuid() });
export type CreateRevisionRequest = z.infer<typeof createRevisionRequest>;

/** Exactly what the viewer may press on the item now. */
export const workItemActions = z.object({
  /** Take the pooled Step. */
  claim: z.boolean(),
  /** Give the Step they claimed back to its pool. */
  release: z.boolean(),
  /** Save draft: change the Form's answers (the raiser's Company, in Draft). */
  saveAnswers: z.boolean(),
  /**
   * Create a Revision (workflow-engine.md §5.4): the latest item of its chain,
   * closed with Code C, no Revision of it open, for a Member of the raiser's
   * Company whom the Workflow's Draft Step allows.
   */
  createRevision: z.boolean(),
  /** Discard this Revision: still in Draft, never numbered, for the raiser's Company. */
  discardRevision: z.boolean(),
  transitions: z.array(
    z.object({
      key: z.string(),
      label: bilingualText,
      kind: z.enum(transitionKinds),
      /**
       * Its Action Form, filled in its pop-up above the Internal Note, which
       * every pop-up has; null when it asks nothing else.
       */
      actionForm: formSchema.nullable(),
    }),
  ),
});
export type WorkItemActions = z.infer<typeof workItemActions>;

/** One Work Item, for someone who can see it. */
export const workItemDetail = workItemSummary.extend({
  /** The Form Version the item is pinned to, for good (ADR 0006). */
  formVersionId: z.uuid(),
  /** Its place in its chain of Revisions: 0 for the first submission, then 1, 2… (its number's " Rev n"). */
  revisionNo: z.number().int().nonnegative(),
  /** A Revision pinned to a newer Form or Workflow Version than the item it revises: the page says so. */
  versionsChanged: z.boolean(),
  /**
   * With `versionsChanged`: the fields the revised item's Form Version has and
   * this Revision's doesn't (dropped, or its key now another type), whose answers
   * were not copied; the notice lists them (form-engine.md §7). Empty otherwise.
   */
  droppedFields: z.array(z.object({ key: z.string(), label: bilingualText })),
  /**
   * The Form's answers by field key, exactly as typed. The Built-in Fields hold
   * ids: `trade` and `location` the item's `trade` and `location`, `scopes` its `scopes`.
   * A `member` answer naming another Company's Member, or a `participant` one
   * naming a Company the viewer may not see, is left out (V14, V15):
   * `namedAnswers` has what they may read instead.
   */
  answers: formAnswers,
  /** The `member` and `participant` answers as the viewer may read them, by field key. */
  namedAnswers,
  /** When each answer last changed and by whom, by field key; only for a viewer who may save, else empty. */
  fieldTimes: z.record(z.string(), fieldTime),
  /** The web autosaves it: only the first Draft, where saves write no history. */
  autosave: z.boolean(),
  /** The item's Scopes and Sub-scopes, each Scope before its Sub-scopes. */
  scopes: z.array(z.object({ id: z.uuid(), parentId: z.uuid().nullable(), name: bilingualText })),
  step: z.object({ key: z.string(), name: bilingualText }),
  raisedBy: z.object({ companyName: bilingualText }),
  /**
   * Who holds the current Step. Another Company is shown by its name only; a
   * person's name only within the viewer's own Company (visibility.md V14).
   */
  heldBy: z.object({ companyName: bilingualText, memberName: bilingualText.nullable() }).nullable(),
  /** Set once closed: the Issued Code (A, C…). */
  outcome: workItemOutcome.nullable(),
  closedAt: z.iso.datetime().nullable(),
  /**
   * The Creation Date: when it got its Document Number, first leaving Draft. Only
   * for the raiser's Participant; null for everyone else and while in Draft. When
   * the Draft was started is never shown (visibility.md "Creation Date").
   */
  creationDate: z.iso.datetime().nullable(),
  /** The Submission Date: its first Submit out of the raiser's Participant, kept after a Send Back. Null until then. */
  submissionDate: z.iso.datetime().nullable(),
  /** What the viewer may press now. */
  actions: workItemActions,
});
export type WorkItemDetail = z.infer<typeof workItemDetail>;

export const workItemEventTypes = [
  "created",
  "transition",
  "recommend_code",
  "issue_code",
  "assigned",
  "claimed",
  "released",
  "vacated",
  "admin_reassigned",
  "admin_reset",
  "internal_note",
  "cancelled",
  "answers_changed",
] as const;

/**
 * The item's history as the viewer may see it: shared events, and internal ones
 * only within the viewer's own Participant (visibility.md V5).
 */
export const workItemHistory = z.object({
  events: z.array(
    z.object({
      /** 1, 2, 3… over the events the viewer sees: gaps would count other Participants' internal ones (V5). */
      seq: z.number().int().positive(),
      type: z.enum(workItemEventTypes),
      at: z.iso.datetime(),
      audience: z.enum(["shared", "internal"]),
      /**
       * Another Company by its name only; a person only within the viewer's own,
       * except whoever issued a Code, named to everyone who sees it (V14).
       */
      by: z.object({ companyName: bilingualText.nullable(), memberName: bilingualText.nullable() }),
      transition: bilingualText.nullable(),
      fromStep: bilingualText.nullable(),
      toStep: bilingualText.nullable(),
      reason: z.string().nullable(),
      /** The Remarks written with a Code (MAR Workflow Version 2): shared with everyone who sees the event. */
      remarks: z.string().nullable(),
      /** Set on the event that assigned it. */
      documentNumber: z.string().nullable(),
      /** Set on the event that closed the item: the Issued Code. */
      outcome: workItemOutcome.nullable(),
      /** Set on an internal_note event: the Internal Note, written with its `transition`. */
      internalNote: z.string().nullable(),
      /**
       * Set on an answers_changed event: each answer changed after Draft, by field
       * key, a missing answer as null. Internal to the raiser's Participant (V5).
       */
      changes: z.array(z.object({ field: z.string(), old: z.unknown(), new: z.unknown() })).nullable(),
    }),
  ),
});
export type WorkItemHistory = z.infer<typeof workItemHistory>;
