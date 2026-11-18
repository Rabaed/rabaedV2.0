import { describe, expect, it } from "vitest";
import { isFirstDraft, saveButton } from "./save-button.ts";

describe("the item page's save button (RP-518)", () => {
  it("is 'Save and close' on a Draft, and always enabled", () => {
    expect(saveButton({ draft: true, dirty: false, pending: false })).toEqual({ label: "saveAndClose", closes: true, disabled: false });
    expect(saveButton({ draft: true, dirty: true, pending: false })).toEqual({ label: "saveAndClose", closes: true, disabled: false });
  });

  it("is plain 'Save' once the item has left Draft, and waits for a change", () => {
    expect(saveButton({ draft: false, dirty: false, pending: false })).toEqual({ label: "save", closes: false, disabled: true });
    expect(saveButton({ draft: false, dirty: true, pending: false })).toEqual({ label: "save", closes: false, disabled: false });
  });

  it("is disabled while a save is out", () => {
    expect(saveButton({ draft: true, dirty: true, pending: true }).disabled).toBe(true);
    expect(saveButton({ draft: false, dirty: true, pending: true }).disabled).toBe(true);
  });
});

describe("a Form is a Draft's that never left Draft (RP-1316)", () => {
  it("before it is created, and while the API autosaves it (a Revision Draft included: no number yet)", () => {
    expect(isFirstDraft({ workItemId: "", documentNumber: null, autosave: false })).toBe(true);
    expect(isFirstDraft({ workItemId: "w1", documentNumber: null, autosave: true })).toBe(true);
  });

  it("not in Internal Review, though it has no Document Number until its first Submit (ADR 0030)", () => {
    expect(isFirstDraft({ workItemId: "w1", documentNumber: null, autosave: false })).toBe(false);
  });

  it("not once it has a Document Number", () => {
    expect(isFirstDraft({ workItemId: "w1", documentNumber: "RBD-MAR-0001", autosave: false })).toBe(false);
  });
});
