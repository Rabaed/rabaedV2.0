import { z } from "zod";
import { bilingualText, type BilingualText } from "./company.ts";
import type { Locale } from "./locale.ts";

// Outcome sets (RP-429, WF-6; spec RP-423; glossary Outcome; workflow-engine.md §1
// "Outcomes", §6). Each Work Item Type has its own ordered set of outcomes: a
// code, an English and Arabic name, whether it closes the item, positive or
// negative, and follow-up actions. A Project runs its own copy of each Rabaed
// Default Type's set (as it runs its own Stages); its Project Admin adds outcomes
// and changes their names, follow-up actions and order there. Rabaed Defaults
// never change in place. The database keeps the same sets (`outcome`, seeded by
// app.default_outcomes; seam 2 checks the two agree).

/**
 * How a Work Item Type's items end (`work_item_type.outcome_kind`): which Rabaed
 * Default set a new Type starts with. Its outcomes are then the Type's own.
 */
export const outcomeKinds = ["review_code", "inspection_result", "approval", "none"] as const;
export type OutcomeKind = (typeof outcomeKinds)[number];

/**
 * Codes the engine and the Dashboard keep for themselves: a cancelled item's
 * outcome (§9, Cancel) and the Dashboard's buckets of open chains.
 */
export const reservedOutcomeCodes = ["cancelled", "pending", "in_preparation"] as const;

/** The shape of an outcome code: a letter, then letters, digits or underscores; at most 32. */
export const outcomeCodePattern = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** An outcome a Type's set may hold: never a reserved code. */
export const outcomeCode = z
  .string()
  .regex(outcomeCodePattern)
  .refine((code) => !(reservedOutcomeCodes as readonly string[]).includes(code), "a reserved code");

export const outcomePolarities = ["positive", "negative"] as const;
export type OutcomePolarity = (typeof outcomePolarities)[number];

/**
 * A follow-up action of an outcome, which later commands read:
 * - `create_items`: each row of the closing Transition's Action Form table of
 *   items becomes a Work Item of Type `type` (WF-11: Code B's Comments);
 * - `offer_revision`: the raiser may create a Revision (§5.4: Code C);
 * - `offer_replacement`: the raiser may create a replacement (§5.5, WF-12: Code D).
 */
export const outcomeAction = z.discriminatedUnion("kind", [
  // A Work Item Type code (work-item.ts `workItemTypeCode`).
  z.object({ kind: z.literal("create_items"), type: z.string().regex(/^[A-Z]{2,6}$/) }).strict(),
  z.object({ kind: z.literal("offer_revision") }).strict(),
  z.object({ kind: z.literal("offer_replacement") }).strict(),
]);
export type OutcomeAction = z.infer<typeof outcomeAction>;
export type OutcomeActionKind = OutcomeAction["kind"];

/** An outcome's follow-up actions: each kind at most once. */
export const outcomeActions = z
  .array(outcomeAction)
  .max(3)
  .refine((actions) => new Set(actions.map((a) => a.kind)).size === actions.length, "each kind once");

export const outcomeSchema = z.object({
  code: outcomeCode,
  name: bilingualText,
  /** A closing Transition may set it (check 3); one that doesn't close is never an item's outcome. */
  closing: z.boolean(),
  polarity: z.enum(outcomePolarities),
  actions: outcomeActions,
});
export type Outcome = z.infer<typeof outcomeSchema>;

const outcome = (code: string, en: string, ar: string, polarity: OutcomePolarity, actions: OutcomeAction[] = []): Outcome => ({
  code,
  name: { en, ar },
  closing: true,
  polarity,
  actions,
});

/**
 * The Rabaed Default sets, by outcome kind. `CMT` is the Snag List's Comment
 * Type (WF-11 adds it): Code B's action items become Comments.
 */
export const defaultOutcomeSets: Record<OutcomeKind, readonly Outcome[]> = {
  review_code: [
    outcome("A", "Approved", "معتمد", "positive"),
    outcome("B", "Approved with Comments", "معتمد مع ملاحظات", "positive", [{ kind: "create_items", type: "CMT" }]),
    outcome("C", "Revise and Resubmit", "يُراجع ويُعاد تقديمه", "negative", [{ kind: "offer_revision" }]),
    outcome("D", "Rejected", "مرفوض", "negative", [{ kind: "offer_replacement" }]),
  ],
  inspection_result: [
    outcome("passed", "Passed", "ناجح", "positive"),
    outcome("passed_with_comments", "Passed with Comments", "ناجح مع ملاحظات", "positive"),
    outcome("failed", "Failed", "راسب", "negative"),
  ],
  approval: [outcome("approved", "Approved", "معتمد", "positive"), outcome("rejected", "Rejected", "مرفوض", "negative")],
  none: [outcome("closed", "Closed", "مغلق", "positive")],
};

const hasAction = (o: Pick<Outcome, "actions">, kind: OutcomeActionKind) => o.actions.some((a) => a.kind === kind);

/** Whether closing with it offers the raiser a Revision (Code C). */
export const offersRevision = (o: Pick<Outcome, "actions">): boolean => hasAction(o, "offer_revision");

/** Whether closing with it offers the raiser a replacement (Code D). */
export const offersReplacement = (o: Pick<Outcome, "actions">): boolean => hasAction(o, "offer_replacement");

/**
 * How a card shows an outcome (RP-410, the Kanban card anatomy), from its place in
 * its Type's set, never its code: `a` the set's first positive outcome with no
 * follow-up (the clean approval, the only one that turns a card green), `b` any
 * other positive one, `c` one offering a Revision, `d` any other negative one.
 */
export type OutcomeLook = "a" | "b" | "c" | "d";
export function outcomeLook<O extends Pick<Outcome, "code" | "polarity" | "actions">>(o: O, set: readonly O[]): OutcomeLook {
  if (offersRevision(o)) return "c";
  if (o.polarity === "negative") return "d";
  const clean = set.find((x) => x.polarity === "positive" && x.actions.length === 0);
  return clean?.code === o.code ? "a" : "b";
}

/** The Type code its Action Form rows become items of (Code B's Comments), or null. */
export function itemsToCreate(o: Pick<Outcome, "actions">): string | null {
  for (const a of o.actions) if (a.kind === "create_items") return a.type;
  return null;
}

/**
 * The outcomes a Type's Dashboard card shows as bars, in order: those offering a
 * Revision first (they are back with the raiser), then the positive, then the
 * negative, each in the set's order. Only closing outcomes, and none when the set
 * has fewer than two: its closed chains count by their Stage, Approved or Rejected.
 */
export function dashboardBarOutcomes<O extends Pick<Outcome, "closing" | "polarity" | "actions">>(set: readonly O[]): O[] {
  const closing = set.filter((o) => o.closing);
  if (closing.length < 2) return [];
  return [
    ...closing.filter(offersRevision),
    ...closing.filter((o) => !offersRevision(o) && o.polarity === "positive"),
    ...closing.filter((o) => !offersRevision(o) && o.polarity === "negative"),
  ];
}

/** An outcome's name for a label: a letter code (at most 3 characters) after its name, "Approved (A)"; any other by its name. */
export function outcomeLabel(o: { code: string; name: BilingualText }, locale: Locale): string {
  return o.code.length <= 3 ? `${o.name[locale]} (${o.code})` : o.name[locale];
}

/** An outcome of a Project's copy of a Type, as every Project Member reads it, in the set's order. */
export const typeOutcomes = z.object({
  type: z.object({ code: z.string(), name: bilingualText }),
  /** For its Project Admins: they add outcomes and change them. */
  canEdit: z.boolean(),
  outcomes: z.array(outcomeSchema),
});
export type TypeOutcomes = z.infer<typeof typeOutcomes>;

/** A Project Admin adds an outcome to the Project's copy of a Type. */
export const addOutcomeRequest = outcomeSchema.strict();
export type AddOutcomeRequest = z.infer<typeof addOutcomeRequest>;

/**
 * A Project Admin changes an outcome's names and follow-up actions, and, while it is
 * unused (no published Workflow Version the Project's items can run names it), its code,
 * closing and polarity (each left out: kept). Decided 2026-10-09.
 */
export const changeOutcomeRequest = z
  .object({ name: bilingualText, actions: outcomeActions, code: outcomeCode.optional(), closing: z.boolean().optional(), polarity: z.enum(outcomePolarities).optional() })
  .strict();
export type ChangeOutcomeRequest = z.infer<typeof changeOutcomeRequest>;

/** Every outcome code of the set, each once, in the new order. */
export const reorderOutcomesRequest = z
  .object({
    codes: z
      .array(outcomeCode)
      .min(1)
      .max(50)
      .refine((codes) => new Set(codes).size === codes.length, "each outcome once"),
  })
  .strict();
export type ReorderOutcomesRequest = z.infer<typeof reorderOutcomesRequest>;

/** The refusals of the outcome commands (app.add_outcome, app.change_outcome, app.reorder_outcomes). */
export const outcomeRefusals = ["not_found", "project_closed", "invalid_outcome", "outcome_exists", "invalid_order", "outcome_in_use"] as const;

/** Why a used outcome's code, closing or polarity can't change (`outcome_in_use`). */
export const outcomeInUseMessage: BilingualText = {
  en: "A Workflow of this Project closes items with this outcome, so its code, and whether it closes and is positive or negative, can't change.",
  ar: "يُغلق سير عمل في هذا المشروع العناصر بهذه النتيجة، فلا يتغيّر رمزها ولا كونها مُغلِقة أو إيجابية أو سلبية.",
};
