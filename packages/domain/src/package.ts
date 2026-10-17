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

/** A Package as a list shows it: what every Member who sees it reads. */
export const packageSummary = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** PKG-001…, per Project and owning Participant (packageNumber). */
  number: z.string(),
  name: bilingualText,
  status: packageStatus,
  /** The owning Participant, by its Company's name only (V14). */
  owner: z.object({ participantId: z.uuid(), companyName: bilingualText }),
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

/** One Package as the viewer reads it: only the submittals they see, and what they may do with it. */
export const packageDetail = packageSummary.extend({
  items: z.array(packageItem),
  actions: z.object({
    /** Rename it (also once In Progress, recorded). */
    rename: z.boolean(),
    /** Add a submittal of the owning Participant. */
    addItems: z.boolean(),
    /** Remove a submittal: only while Open. */
    removeItems: z.boolean(),
    /** Delete it: only while Open; its submittals stay, without a Package. */
    delete: z.boolean(),
  }),
});
export type PackageDetail = z.infer<typeof packageDetail>;

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
