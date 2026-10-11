import { describe, expect, it } from "vitest";
import { withFileCopies } from "./copy-files.ts";
import { noFileStore, type FileStore } from "./file-store.ts";

/** A store in memory whose copy fails for the keys in `failOn`. */
function memoryStore(failOn: string[] = []) {
  const objects = new Set(["a", "b", "c"]);
  const store: FileStore = {
    ...noFileStore,
    copy: async (from, to) => {
      if (failOn.includes(to)) throw new Error(`copy ${to} failed`);
      if (!objects.has(from)) throw new Error(`no ${from}`);
      objects.add(to);
    },
    remove: async (key) => {
      objects.delete(key);
    },
  };
  return { store, objects };
}

const copies = [
  { source_storage_key: "a", storage_key: "a2" },
  { source_storage_key: "b", storage_key: "b2" },
  { source_storage_key: "c", storage_key: "c2" },
];

describe("withFileCopies (RP-409)", () => {
  it("keeps the copies when everything succeeds", async () => {
    const { store, objects } = memoryStore();
    expect(await withFileCopies(store, async (copy) => (await copy(copies), "done"))).toBe("done");
    expect([...objects].sort()).toEqual(["a", "a2", "b", "b2", "c", "c2"]);
  });

  it("deletes the copies already made when a later copy fails", async () => {
    const { store, objects } = memoryStore(["c2"]);
    await expect(withFileCopies(store, (copy) => copy(copies))).rejects.toThrow("copy c2 failed");
    expect([...objects].sort()).toEqual(["a", "b", "c"]);
  });

  it("deletes the copies when the database fails after them, the originals untouched", async () => {
    const { store, objects } = memoryStore();
    await expect(
      withFileCopies(store, async (copy) => {
        await copy(copies);
        throw new Error("commit failed");
      }),
    ).rejects.toThrow("commit failed");
    expect([...objects].sort()).toEqual(["a", "b", "c"]);
  });
});
