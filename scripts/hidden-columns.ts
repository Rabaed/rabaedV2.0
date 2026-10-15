// The columns the visibility rules hide (RP-534): from the app database role,
// or from every Participant but one. docs/visibility.md points here. A hidden
// value stays out of the sort keys derived from it (CODING_STANDARDS
// §Visibility, "A hidden value stays out of everything derived from it"), so
// `pnpm check:migrations` reports a new migration that sorts by one of these
// (scripts/check-migrations-hidden-sort.ts). Add a column here when a rule
// hides it, with the docs/visibility.md row that does.

/** A hidden column: its table, its name, and the docs/visibility.md row that hides it. */
export interface HiddenColumn {
  table: string;
  column: string;
  rule: string;
}

export const hiddenColumns: readonly HiddenColumn[] = [
  // When the Draft was started: shown to nobody once numbered, and never to another Company.
  { table: "work_item", column: "created_at", rule: 'Rules › "Creation Date" (RP-334: rabaed_app reads neither `created_at` nor the `created` event)' },
  // The same time, copied into a Step's and the raiser's access rows (RP-309, RP-334).
  { table: "step_assignment", column: "created_at", rule: 'Rules › "Creation Date" (RP-334: nor a Step\'s `picked_up_at`, `created_at` or `updated_at`)' },
  { table: "step_assignment", column: "updated_at", rule: 'Rules › "Creation Date" (RP-334: nor a Step\'s `picked_up_at`, `created_at` or `updated_at`)' },
  { table: "step_assignment", column: "picked_up_at", rule: 'Rules › "Creation Date" (RP-334: nor a Step\'s `picked_up_at`, `created_at` or `updated_at`)' },
  { table: "work_item_access", column: "since", rule: 'Rules › "Creation Date" (RP-334: nor the raiser\'s `work_item_access.since`)' },
  // Document and Link times earlier than the Creation Date (RP-399).
  { table: "document", column: "created_at", rule: 'Rules › "Creation Date", Document and Link times; scenario RP-399-1' },
  { table: "document", column: "confirmed_at", rule: 'Rules › "Creation Date", Document and Link times; scenario RP-399-1' },
  { table: "work_item_link", column: "created_at", rule: 'Rules › "Creation Date", Document and Link times; scenario RP-399-1' },
];
