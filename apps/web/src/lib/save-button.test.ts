import { describe, expect, it } from "vitest";
import { saveButton } from "./save-button.ts";

describe("the item page's save button (RP-518)", () => {
  it("is 'Save and close' on a Draft, which has no Document Number yet, and always enabled", () => {
    expect(saveButton({ documentNumber: null, dirty: false, pending: false })).toEqual({ label: "saveAndClose", closes: true, disabled: false });
    expect(saveButton({ documentNumber: null, dirty: true, pending: false })).toEqual({ label: "saveAndClose", closes: true, disabled: false });
  });

  it("is 'Save and close' on a Revision Draft too: it has no number until it is first Submitted", () => {
    // A Revision Draft: documentNumber null (the API gives " Rev n" only after it leaves Draft).
    expect(saveButton({ documentNumber: null, dirty: false, pending: false }).label).toBe("saveAndClose");
  });

  it("is plain 'Save' once the item has a Document Number, and waits for a change", () => {
    expect(saveButton({ documentNumber: "RBD-MAR-0001", dirty: false, pending: false })).toEqual({ label: "save", closes: false, disabled: true });
    expect(saveButton({ documentNumber: "RBD-MAR-0001", dirty: true, pending: false })).toEqual({ label: "save", closes: false, disabled: false });
  });

  it("is disabled while a save is out", () => {
    expect(saveButton({ documentNumber: null, dirty: true, pending: true }).disabled).toBe(true);
    expect(saveButton({ documentNumber: "RBD-MAR-0001", dirty: true, pending: true }).disabled).toBe(true);
  });
});
