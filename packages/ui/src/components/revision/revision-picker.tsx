"use client";

import { formatNumber, type Locale } from "@rabaed/domain";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Field } from "../form/field.tsx";
import { Select } from "../form/select.tsx";

// The Revision drop-down on the item page (RP-318; workflow-engine.md §5.4 "The
// item page shows the chain", visibility.md the Revisions channel). It lists
// the Revisions of the chain exactly as the API returns them: only those the
// viewer may see, the original first. Each shows its Document Number whole, a
// Revision's " Rev n" included, left to right in both languages, as issued and
// as on the paper register. Presentational: the page opens the chosen one.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: { label: "Revision" },
  ar: { label: "المراجعة" },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

export type RevisionPickerProps = {
  locale: Locale;
  /** The chain as the API lists it (`RevisionChain.revisions`), in order. */
  revisions: { id: string; documentNumber: string | null; revisionNo: number }[];
  /** The Revision on the page: shown, and marked in the list. */
  currentId: string;
  /** A Draft Revision, by its Rev number formatted for the viewer: the app's one wording, as the List and the Kanban show it. */
  revisionNoNumber: (revision: string) => string;
  /** Opens the chosen Revision; never called for the one already open. */
  onOpen: (id: string) => void;
};

/** A drop-down of the chain's Revisions; nothing when the viewer sees no other Revision. */
export function RevisionPicker({ locale, revisions, currentId, revisionNoNumber, onOpen }: RevisionPickerProps) {
  const t = copy[locale];
  if (revisions.length < 2) return null;
  return (
    <Field label={t.label}>
      <Select
        value={currentId}
        onValueChange={(id) => {
          if (id !== currentId) onOpen(id);
        }}
        options={revisions.map((r) => ({
          value: r.id,
          label: r.documentNumber ? <DocNo value={r.documentNumber} /> : revisionNoNumber(formatNumber(r.revisionNo, locale)),
        }))}
      />
    </Field>
  );
}
