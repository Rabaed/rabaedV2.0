import { z } from "zod";
import { bilingualText } from "./company.ts";

/**
 * A Package (spec RP-616, GLOSSARY.md Package): a named group of submittals that one
 * Participant puts together. Open until any submittal in it has been Submitted, then
 * In Progress, and Done once every latest submittal in it has closed at Code A, B or D.
 */
export const packageStatuses = ["open", "in_progress", "done"] as const;
export const packageStatus = z.enum(packageStatuses);
export type PackageStatus = z.infer<typeof packageStatus>;

/**
 * A Package's number as shown, `PKG-` and its sequence in three digits or more
 * (PKG-001, PKG-1000), always left-to-right, also in Arabic.
 */
export function packageNumber(seq: number): string {
  return `PKG-${String(seq).padStart(3, "0")}`;
}

/**
 * A Package's counts as one viewer reads them (RP-641): of the submittals they see only,
 * never a total that includes one they don't (visibility.md RP-588-2). Cancelled and
 * discarded submittals are left out.
 */
export const packageCounts = z.object({
  /** The submittals the viewer sees. */
  total: z.number().int().nonnegative(),
  /** Of those, the ones still open. */
  open: z.number().int().nonnegative(),
  /** Of those, the closed ones by Review Code (or other outcome), e.g. `{ A: 2, C: 1 }`; a code with none is absent. */
  codes: z.record(z.string(), z.number().int().positive()),
});
export type PackageCounts = z.infer<typeof packageCounts>;

/**
 * A Package as the board shows it (RP-641): what every Member who sees it reads. Its
 * status comes from all its submittals, one word for everyone (spec RP-616 "Status");
 * its counts from the ones the viewer sees.
 */
export const packageSummary = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** PKG-001…, per Project and owning Participant (packageNumber). */
  number: z.string(),
  name: bilingualText,
  status: packageStatus,
  /** The owning Participant, by its Company's name only (V14), for every viewer. */
  owner: z.object({ participantId: z.uuid(), companyName: bilingualText }),
  counts: packageCounts,
});
export type PackageSummary = z.infer<typeof packageSummary>;

/** A Project's Packages the viewer sees, by owner then number. */
export const packageList = z.object({ packages: z.array(packageSummary) });
export type PackageList = z.infer<typeof packageList>;

/** A submittal of a Package, as the viewer sees it. `title` is its Subject. */
export const packageItem = z.object({
  id: z.uuid(),
  /** Null while Draft. */
  documentNumber: z.string().nullable(),
  title: z.string(),
});
export type PackageItem = z.infer<typeof packageItem>;

/** The Package of a Work Item, where the viewer sees the Package: the chip on its row. */
export const workItemPackage = z.object({ id: z.uuid(), number: z.string(), name: bilingualText });
export type WorkItemPackage = z.infer<typeof workItemPackage>;

/** Create a Package, or rename one: its name in English and Arabic. */
export const packageNameRequest = z.object({ name: bilingualText });
export type PackageNameRequest = z.infer<typeof packageNameRequest>;

/** Add a submittal to a Package. */
export const addPackageItemRequest = z.object({ workItemId: z.uuid() });
export type AddPackageItemRequest = z.infer<typeof addPackageItemRequest>;

/** A new Package: its id and number. */
export const createdPackage = z.object({ id: z.uuid(), number: z.string() });
export type CreatedPackage = z.infer<typeof createdPackage>;

/**
 * Submit Package (RP-638), confirmed in its pop-up (ADR 0017). The key makes a
 * repeated request apply only once, answering with the same items.
 */
export const submitPackageRequest = z.object({ confirmed: z.boolean().default(false), idempotencyKey: z.uuid() });
export type SubmitPackageRequest = z.input<typeof submitPackageRequest>;

/** A Submit Package taken: the submittals it Submitted, each with its new Document Number. */
export const submittedPackage = z.object({ submitted: z.array(packageItem) });
export type SubmittedPackage = z.infer<typeof submittedPackage>;

/**
 * Why a submittal stops a Submit Package: it waits in the viewer's Step Pool
 * (`pick_up_first`), it is at no Step where they can Submit it (`cannot_submit`),
 * or its Submit refuses it as a single Submit would: its Form incomplete, its
 * Action Form, a Validate rule, or another refusal of the engine (`refused`).
 */
export const packageNotReadyReasons = [
  "pick_up_first",
  "cannot_submit",
  "form_incomplete",
  "invalid_action_form",
  "validation_failed",
  "refused",
] as const;
export const packageNotReadyReason = z.enum(packageNotReadyReasons);
export type PackageNotReadyReason = z.infer<typeof packageNotReadyReason>;

/** A submittal the viewer sees that stops a Submit Package, and why. */
export const packageNotReadyItem = packageItem.extend({ reason: packageNotReadyReason });
export type PackageNotReadyItem = z.infer<typeof packageNotReadyItem>;
