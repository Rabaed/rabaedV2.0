/**
 * The save button on a Work Item's page (RP-511 decision 10). A Draft, which has no
 * Document Number yet (a Revision Draft included), autosaves or saves with the button
 * and gets "Save and close": always enabled, it saves anything pending and goes to the
 * Project's list. Any other editable item gets "Save", which waits for a change.
 */
export type SaveButton = {
  /** The message key under `workItems.form`. */
  label: "saveAndClose" | "save";
  /** Goes to the Project's Submittals list once saved. */
  closes: boolean;
  disabled: boolean;
};

export function saveButton({ documentNumber, dirty, pending }: { documentNumber: string | null; dirty: boolean; pending: boolean }): SaveButton {
  if (documentNumber === null) return { label: "saveAndClose", closes: true, disabled: pending };
  return { label: "save", closes: false, disabled: pending || !dirty };
}
