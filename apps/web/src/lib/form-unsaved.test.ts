import { describe, expect, it } from "vitest";
import { autosavesNow, unsavedAfterSave } from "./form-unsaved.ts";

// The Form's unsaved state (WorkItemFormProvider), apart from React so it is tested on its own.
// RP-1221, UAT J9: after the New item panel's create, autosave re-sent every answer about 2 s
// later with nothing typed, over an edit made meanwhile elsewhere. Answers are saved only when
// typed since the last save, whoever saved them: the create counts as a save.

type Answers = Readonly<Record<string, unknown>>;

/** The provider's flow, step by step: what the Member typed, what was saved, and whether autosave would send. */
function form(start: Answers) {
  let answers = start;
  let dirty = false;
  return {
    type(changes: Answers) {
      answers = { ...answers, ...changes };
      dirty = true;
    },
    /** A save of the answers as they are now: the panel's create, or the provider's own PUT. */
    send(): Answers {
      return answers;
    },
    saved(sent: Answers) {
      dirty = unsavedAfterSave(answers, sent);
    },
    autosaves: () => autosavesNow({ autosave: true, editable: true, dirty, pending: false }),
  };
}

describe("the Form's unsaved answers", () => {
  it("after the panel's create, with nothing typed since: nothing to autosave", () => {
    const f = form({ trade: "el" });
    f.type({ description: "Cable trays" });
    const sent = f.send();
    f.saved(sent);
    expect(f.autosaves()).toBe(false);
  });

  it("typed while the create was out: that stays unsaved, and autosave carries it", () => {
    const f = form({});
    f.type({ description: "Cable trays" });
    const sent = f.send();
    f.type({ description: "Cable trays, Floor 02" });
    f.saved(sent);
    expect(f.autosaves()).toBe(true);
  });

  it("typed after the create: autosave sends it", () => {
    const f = form({});
    f.type({ description: "Cable trays" });
    f.saved(f.send());
    f.type({ location: "t1f02" });
    expect(f.autosaves()).toBe(true);
  });

  it("autosaves only where it is on, the Form editable, and no save out", () => {
    const on = { autosave: true, editable: true, dirty: true, pending: false };
    expect(autosavesNow(on)).toBe(true);
    expect(autosavesNow({ ...on, autosave: false })).toBe(false);
    expect(autosavesNow({ ...on, editable: false })).toBe(false);
    expect(autosavesNow({ ...on, dirty: false })).toBe(false);
    expect(autosavesNow({ ...on, pending: true })).toBe(false);
  });
});
