/**
 * The save button on a Work Item's page (RP-511 decision 10). A Draft, one that never left Draft
 * (a Revision Draft included), autosaves or saves with the button and gets "Save and close": always
 * enabled, it saves anything pending and goes to the Project's list. Any other editable item gets
 * "Save", which waits for a change: an item in Internal Review too, though it has no Document Number
 * until its first Submit (ADR 0030, RP-1316).
 */
export type SaveButton = {
  /** The message key under `workItems.form`. */
  label: "saveAndClose" | "save";
  /** Goes to the Project's Submittals list once saved. */
  closes: boolean;
  disabled: boolean;
};

export function saveButton({ draft, dirty, pending }: { draft: boolean; dirty: boolean; pending: boolean }): SaveButton {
  if (draft) return { label: "saveAndClose", closes: true, disabled: pending };
  return { label: "save", closes: false, disabled: pending || !dirty };
}

/**
 * Whether the Form is a Draft's that never left Draft: one not yet created (no id), or one the API
 * autosaves, which is only such a Draft (`app.answers_autosave`). No Document Number alone no longer
 * says so: an item in Internal Review has none either (ADR 0030).
 */
export function isFirstDraft({ workItemId, documentNumber, autosave }: { workItemId: string; documentNumber: string | null; autosave: boolean }): boolean {
  return documentNumber === null && (workItemId === "" || autosave);
}
