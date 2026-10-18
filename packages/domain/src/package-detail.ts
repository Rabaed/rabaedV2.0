import { z } from "zod";
import { packageItem, packageSummary } from "./package.ts";
import { workItemRow } from "./work-item.ts";

// Apart from package.ts, which work-item.ts imports (its rows' Package chip): this
// one reads work-item.ts's row fields, so the two import each other through no cycle.

/**
 * A submittal on a Package's page (RP-641): its Document Number, Subject (`title`),
 * Trade, who it is with (as the List gives it, V14) and its Review Code once closed
 * (`outcome`), as the viewer reads it.
 */
export const packageDetailItem = packageItem.extend(workItemRow.pick({ trade: true, with: true, outcome: true }).shape);
export type PackageDetailItem = z.infer<typeof packageDetailItem>;

/** One Package as the viewer reads it: only the submittals they see, and what they may do with it. */
export const packageDetail = packageSummary.extend({
  items: z.array(packageDetailItem),
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
