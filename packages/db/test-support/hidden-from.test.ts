import { describe, expect, it } from "vitest";
import { expectHiddenFrom } from "./hidden-from.ts";

type Row = { id: string; title: string };
/** A reader over a table of who reads which rows. */
const reader = (table: Record<string, Row[]>) => async (as: string) => table[as] ?? [];
const row = (id: string, title = "Slab pour"): Row => ({ id, title });

describe("expectHiddenFrom", () => {
  it("passes when an allowed viewer reads the row and the other doesn't", async () => {
    const read = reader({ k1: [row("a"), row("b")], c2: [row("b")] });
    await expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: "c2" });
  });

  it("fails when nobody reads the row: an empty result proves nothing", async () => {
    const read = reader({ c2: [] });
    await expect(expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: "c2" })).rejects.toThrow(/k1 must read a first/);
  });

  it("fails when the hidden viewer reads the row", async () => {
    const read = reader({ k1: [row("a")], c2: [row("a")] });
    await expect(expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: "c2" })).rejects.toThrow(/c2 must not read a/);
  });

  it("compares by id: another row with the same title is no proof", async () => {
    const read = reader({ k1: [row("b")], c2: [] });
    await expect(expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: "c2" })).rejects.toThrow(/k1 must read a first/);
  });

  it("checks every viewer of a list, each way", async () => {
    const read = reader({ k1: [row("a")], ow: [row("a")], c2: [], k1Manager: [row("a")] });
    await expectHiddenFrom({ read, target: "a", seenBy: ["k1", "ow"], hiddenFrom: ["c2"] });
    await expect(expectHiddenFrom({ read, target: "a", seenBy: ["k1"], hiddenFrom: ["c2", "k1Manager"] })).rejects.toThrow(/k1Manager must not read a/);
  });

  it("reads ids with `idOf` when the row's id has another name", async () => {
    const read = async (as: string) => (as === "k1" ? [{ work_item_id: "a" }] : []);
    await expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: "c2", idOf: (r) => r.work_item_id });
  });

  it("names viewers with `name` and prefixes the label", async () => {
    const read = reader({ k1: [row("a")], c2: [row("a")] });
    const people = { k1: "K1 engineer", c2: "C2 engineer" } as Record<string, string>;
    await expect(
      expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: "c2", name: (v) => people[v]!, label: "chat" }),
    ).rejects.toThrow(/chat: C2 engineer must not read a/);
  });

  it("refuses an empty list of viewers", async () => {
    const read = reader({ k1: [row("a")] });
    await expect(expectHiddenFrom({ read, target: "a", seenBy: [], hiddenFrom: "c2" })).rejects.toThrow(/seenBy names nobody/);
    await expect(expectHiddenFrom({ read, target: "a", seenBy: "k1", hiddenFrom: [] })).rejects.toThrow(/hiddenFrom names nobody/);
  });
});
