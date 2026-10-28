import { describe, expect, it } from "vitest";
import { defaultPanelPreferences, panelPreferencesKey, readPanelPreferences, writePanelPreferences } from "./panel-preferences.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

describe("the Submittal Panel's preferences, kept in one place", () => {
  it("opens at the Normal width (640px) with nothing kept", () => {
    expect(readPanelPreferences(memoryStorage())).toEqual(defaultPanelPreferences);
    expect(defaultPanelPreferences.width).toBe(640);
  });

  it("reads back what was kept, and keeps the defaults for what wasn't", () => {
    const storage = memoryStorage();
    writePanelPreferences(storage, { collapsed: { loc: true } });
    expect(readPanelPreferences(storage)).toEqual({ ...defaultPanelPreferences, collapsed: { loc: true } });
    writePanelPreferences(storage, { width: 960 });
    expect(readPanelPreferences(storage)).toEqual({ ...defaultPanelPreferences, width: 960, collapsed: { loc: true } });
  });

  it("ignores a kept value of the wrong shape", () => {
    const storage = memoryStorage({ [panelPreferencesKey]: JSON.stringify({ width: "wide", collapsed: [1], tab: 3 }) });
    expect(readPanelPreferences(storage)).toEqual(defaultPanelPreferences);
    expect(readPanelPreferences(memoryStorage({ [panelPreferencesKey]: "{not json" }))).toEqual(defaultPanelPreferences);
  });

  it("works without storage (a private window, or storage that throws)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPanelPreferences(throwing)).toEqual(defaultPanelPreferences);
    expect(() => writePanelPreferences(throwing, { width: 960 })).not.toThrow();
    expect(readPanelPreferences(null)).toEqual(defaultPanelPreferences);
  });
});
