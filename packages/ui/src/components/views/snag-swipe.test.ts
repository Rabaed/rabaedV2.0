import type { WorkItemActions } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { swipeActionsOf, swipeSettles, swipeWidth } from "./snag-swipe.ts";

// Story data only.
const b = (en: string) => Object.fromEntries([
  ["en", en],
  ["ar", en],
]) as { en: string; ar: string };
const transition = (key: string, kind: WorkItemActions["transitions"][number]["kind"]) => ({ key, label: b(key), kind, actionForm: null });
const actions = (transitions: WorkItemActions["transitions"], rest: Partial<WorkItemActions> = {}): WorkItemActions => ({
  pickUp: false,
  returnToPool: false,
  saveAnswers: false,
  createRevision: false,
  createReplacement: false,
  discardRevision: false,
  duplicate: false,
  discardDraft: false,
  signatureRequired: false,
  stampRequired: false,
  transitions,
  ...rest,
});

describe("swipeActionsOf", () => {
  it("is the Transitions the item offers the viewer, forward ones first, and nothing else (RP-630)", () => {
    const open = actions([transition("start_work", "send"), transition("put_on_hold", "send"), transition("resolve", "submit")], { pickUp: true, returnToPool: true });
    expect(swipeActionsOf(open).map((a) => [a.key, a.tone])).toEqual([
      ["resolve", "forward"],
      ["start_work", "move"],
      ["put_on_hold", "move"],
    ]);
  });

  it("leaves out a cancel, kept for the item's page, and puts a Send Back after the forward ones", () => {
    const verify = actions([transition("return_to_open", "send_back"), transition("close", "close"), transition("cancel", "cancel")]);
    expect(swipeActionsOf(verify).map((a) => [a.key, a.tone])).toEqual([
      ["close", "forward"],
      ["return_to_open", "back"],
    ]);
  });

  it("is empty when the viewer may take none: a card that offers nothing shows nothing", () => {
    expect(swipeActionsOf(actions([], { pickUp: true }))).toEqual([]);
  });

  it("offers at most three: the item's page has the rest", () => {
    const many = actions(["a", "b", "c", "d"].map((k) => transition(k, "send")));
    expect(swipeActionsOf(many).map((a) => a.key)).toEqual(["a", "b", "c"]);
  });
});

describe("swipeSettles", () => {
  it("opens a card dragged towards the start further than half its actions' width, in either direction of writing", () => {
    expect(swipeSettles(-120, "ltr", 150)).toBe("open");
    expect(swipeSettles(-60, "ltr", 150)).toBe("closed");
    expect(swipeSettles(120, "rtl", 150)).toBe("open");
    // Dragged the wrong way: it stays shut.
    expect(swipeSettles(120, "ltr", 150)).toBe("closed");
    expect(swipeSettles(-120, "rtl", 150)).toBe("closed");
  });

  it("keeps a card with no actions shut, however far it is dragged", () => {
    expect(swipeSettles(-300, "ltr", 0)).toBe("closed");
  });
});

describe("swipeWidth", () => {
  it("is 75px for each action", () => {
    expect(swipeWidth(2)).toBe(150);
    expect(swipeWidth(0)).toBe(0);
  });
});
