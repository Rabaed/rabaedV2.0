import { raisedFromFilterValue, workItemListHref } from "@rabaed/domain";

/**
 * "Open in Snag List" from an item (RP-628, RP-653, RP-1119): the Snag List filtered to the items of
 * `typeCode` raised from the item numbered `documentNumber`, a Revision's (" Rev n") included. Null when
 * the item has no number yet, or its number is no "Raised from" value: no link, rather than one that
 * opens the Snag List unfiltered. The list shows only what the viewer already sees (V3).
 */
export function raisedFromHref(projectId: string, typeCode: string, documentNumber: string | null): string | null {
  if (documentNumber === null || !raisedFromFilterValue.safeParse(documentNumber).success) return null;
  return workItemListHref(projectId, { module: "snag_list", type: [typeCode], raisedFrom: [documentNumber] });
}
