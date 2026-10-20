import { z } from "zod";
import { bulkOffer } from "./bulk-transition.ts";
import { packageItem, packageNotReadyReason, packageSummary } from "./package.ts";
import { workItemList, workItemRow } from "./work-item.ts";

// Apart from package.ts, which work-item.ts imports (its rows' Package chip): this
// one reads work-item.ts's row fields, so the two import each other through no cycle.

/**
 * A submittal on a Package's page (RP-641): its row exactly as the List gives it to the viewer
 * (Document Number, Subject, Trade, who it is with, V14, its Review Code once closed), the latest
 * Revision of its chain (spec story 30).
 */
export const packageDetailItem = workItemRow.extend({
  /** The Transitions the viewer may take on it in bulk now, with others offering the same (RP-646); none when it doesn't wait on them. */
  bulkTransitions: z.array(bulkOffer),
  /**
   * Still to Submit (RP-638's rule, the api's): never Submitted and not closed, so Submit Package
   * would take it. Always false for a viewer outside the owning Participant.
   */
  toSubmit: z.boolean(),
  /**
   * Why it stops Submit Package now (RP-974), with the 409's codes, before any attempt: it waits
   * in the viewer's Step Pool (`pick_up_first`) or at a Step where they can't Submit it
   * (`cannot_submit`). Null when nothing of it stops it, on a closed Project (no Submit Package
   * there), and always for a viewer outside the owning Participant. A refusal found only by taking
   * the Submit (an incomplete Form, a missing Signature) still comes back from the attempt.
   */
  notReady: packageNotReadyReason.nullable(),
});
export type PackageDetailItem = z.infer<typeof packageDetailItem>;

/** One Package as the viewer reads it: only the submittals they see, and what they may do with it. */
export const packageDetail = packageSummary.extend({
  items: z.array(packageDetailItem),
  /** Whether the viewer is of the owning Participant (app.owns_package): only they change it. */
  owned: z.boolean(),
  /**
   * Whether a submittal still to Submit that the viewer doesn't see stops their Submit Package
   * (app.package_hides_unsubmitted, RP-974), never which. Always false outside the owning
   * Participant and on a closed Project.
   */
  othersNotReady: z.boolean(),
  /** What the item table reads around its rows, as the List gives it: each Type's outcomes on the Project, its Trades and Locations. */
  filters: workItemList.shape.filters.pick({ outcomes: true, trades: true, locations: true }),
  /** Every action false for a viewer outside the owning Participant: they read it, and change nothing of it. */
  actions: z.object({
    /** Rename it (also once In Progress, recorded). */
    rename: z.boolean(),
    /** Add a submittal of the owning Participant. */
    addItems: z.boolean(),
    /** Remove a submittal: only while Open. */
    removeItems: z.boolean(),
    /** Delete it: only while Open; its submittals stay, without a Package. */
    delete: z.boolean(),
    /**
     * Submit Package: each not-yet-Submitted submittal's own Submit at once. Only
     * when there is one, and every one of them waits at a Step where the viewer
     * can Submit it (RP-638).
     */
    submit: z.boolean(),
  }),
});
export type PackageDetail = z.infer<typeof packageDetail>;

/**
 * A Comment raised from one of a Package's submittals by its Code B (RP-647), as the
 * viewer reads it in the Snag List, and the submittal it was raised from.
 */
export const packageComment = workItemRow
  .pick({ id: true, type: true, documentNumber: true, title: true, stage: true, with: true, outcome: true })
  .extend({ raisedFrom: packageItem.pick({ id: true, documentNumber: true }) });
export type PackageComment = z.infer<typeof packageComment>;

/**
 * The Comments on a Package's page (spec RP-616 story 35): only those the viewer sees,
 * raised from its submittals they see. For information: they are not part of the
 * Package, and count in none of its counts or its status.
 */
export const packageComments = z.object({ forInformation: z.literal(true), comments: z.array(packageComment) });
export type PackageComments = z.infer<typeof packageComments>;
