// The columns the visibility rules hide (RP-534): from the app database role,
// or from every Participant but one. docs/visibility.md points here. A hidden
// value stays out of the sort keys derived from it (CODING_STANDARDS
// §Visibility, "A hidden value stays out of everything derived from it"), so
// `pnpm check:migrations` reports a new migration that sorts by one of these
// (scripts/check-migrations-hidden-sort.ts). Add a column here when a rule
// hides it, with the docs/visibility.md row that does.
//
// Left out: `work_item_event.created_at`. The rule hides the item's `created`
// event as a row (the event policy reads `type <> 'created'`), not the column:
// every other event's time is the history everyone who reads it sees, and its
// order. The `created` event's time is the Draft's start, `work_item.created_at`,
// which is listed. Listing the column would report every history query.

/** Hidden columns of one table, and the docs/visibility.md row that hides them. */
export interface HiddenColumns {
  table: string;
  columns: readonly string[];
  rule: string;
}

const creationDate = 'Rules › "Creation Date"';

export const hiddenColumns: readonly HiddenColumns[] = [
  // When the Draft was started: shown to nobody once numbered, and never to another Company;
  // answer times ("Saved") are read by no other Company (RP-392).
  { table: "work_item", columns: ["created_at", "field_times"], rule: `${creationDate} (RP-334: rabaed_app reads neither \`created_at\` nor the \`created\` event; RP-392: nor \`field_times\`)` },
  // The same time, copied into a Step's and the raiser's access rows (RP-309, RP-334).
  { table: "step_assignment", columns: ["created_at", "updated_at", "picked_up_at"], rule: `${creationDate} (RP-334: nor a Step's \`picked_up_at\`, \`created_at\` or \`updated_at\`)` },
  { table: "work_item_access", columns: ["since"], rule: `${creationDate} (RP-334: nor the raiser's \`work_item_access.since\`)` },
  // Document and Link times earlier than the Creation Date (RP-399).
  { table: "document", columns: ["created_at", "confirmed_at"], rule: `${creationDate}, Document and Link times; scenario RP-399-1` },
  { table: "work_item_link", columns: ["created_at"], rule: `${creationDate}, Document and Link times; scenario RP-399-1` },
];
