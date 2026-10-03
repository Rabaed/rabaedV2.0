import { z } from "zod";
import { bilingualText } from "./company.ts";
import { formAnswers } from "./form.ts";

/** A Work Item Type's short code, used in filters and Document Numbers (MAR, SAR…). */
export const workItemTypeCode = z.string().regex(/^[A-Z]{2,6}$/);

/**
 * A Contractor Member creates a Work Item in Draft: its Subject (`title` in code),
 * Trade (required), Location, and the answers to its Form so far (checked in draft
 * mode against the latest published Form Version of its Type).
 */
export const createWorkItemRequest = z.object({
  type: workItemTypeCode,
  title: z.string().trim().min(1).max(200),
  tradeId: z.uuid(),
  locationId: z.uuid().nullable().default(null),
  answers: formAnswers.default({}),
});
export type CreateWorkItemRequest = z.input<typeof createWorkItemRequest>;

export const createdWorkItem = z.object({ id: z.uuid() });

/** Save draft: the Draft's answers so far, checked in draft mode (types, not required). */
export const saveAnswersRequest = z.object({ answers: formAnswers });
export type SaveAnswersRequest = z.infer<typeof saveAnswersRequest>;

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

/**
 * A Project's Work Items the viewer can see, and every Stage with how many of
 * them are in it. Counts come from the same visible items, never from all.
 */
export const workItemList = z.object({
  stages: z.array(stage.extend({ count: z.number().int().nonnegative() })),
  items: z.array(workItemSummary),
});
export type WorkItemList = z.infer<typeof workItemList>;

/** How a closed Work Item ended: its Issued Code, Inspection result, or cancelled (workflow-engine.md §1). */
export const workItemOutcomes = ["A", "B", "C", "D", "passed", "passed_with_comments", "failed", "cancelled", "closed"] as const;
export const workItemOutcome = z.enum(workItemOutcomes);
export type WorkItemOutcome = z.infer<typeof workItemOutcome>;

/** A Transition's kind (workflow-engine.md §1). */
export const transitionKinds = ["send", "submit", "return", "close", "cancel"] as const;

/**
 * The holder of the current Step takes one of its Transitions. The key makes a
 * repeated request (a double-click, a retry) apply only once.
 */
export const takeTransitionRequest = z.object({
  transition: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** Required for a Return. */
  reason: z.string().trim().max(2000).default(""),
  /**
   * Optional on any Transition. Seen only by the writer's own Participant, even
   * when the Transition goes to another, such as Submit (visibility.md V5).
   */
  internalNote: z.string().trim().max(4000).default(""),
  idempotencyKey: z.uuid(),
});
export type TakeTransitionRequest = z.input<typeof takeTransitionRequest>;

/** Exactly what the viewer may press on the item now. */
export const workItemActions = z.object({
  /** Take the pooled Step. */
  claim: z.boolean(),
  /** Give the Step they claimed back to its pool. */
  release: z.boolean(),
  /** Save draft: change the Form's answers (the raiser's Company, in Draft). */
  saveAnswers: z.boolean(),
  transitions: z.array(
    z.object({ key: z.string(), label: bilingualText, kind: z.enum(transitionKinds), needsReason: z.boolean() }),
  ),
});
export type WorkItemActions = z.infer<typeof workItemActions>;

/** One Work Item, for someone who can see it. */
export const workItemDetail = workItemSummary.extend({
  /** The Form Version the item is pinned to, for good (ADR 0006). */
  formVersionId: z.uuid(),
  /** The Form's answers by field key, exactly as typed. */
  answers: formAnswers,
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
  createdAt: z.iso.datetime(),
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
      /** Set on the event that assigned it. */
      documentNumber: z.string().nullable(),
      /** Set on the event that closed the item: the Issued Code. */
      outcome: workItemOutcome.nullable(),
      /** Set on an internal_note event: the Internal Note, written with its `transition`. */
      internalNote: z.string().nullable(),
    }),
  ),
});
export type WorkItemHistory = z.infer<typeof workItemHistory>;
