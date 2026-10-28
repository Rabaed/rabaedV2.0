import { describe, expect, it } from "vitest";
import { defaultSubmittalPanelPreferences, submittalPanelPreferencesKey, readSubmittalPanelPreferences, writeSubmittalPanelPreferences } from "./panel-preferences.ts";

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
    expect(readSubmittalPanelPreferences(memoryStorage())).toEqual(defaultSubmittalPanelPreferences);
    expect(defaultSubmittalPanelPreferences.width).toBe(640);
  });

  it("reads back what was kept, and keeps the defaults for what wasn't", () => {
    const storage = memoryStorage();
    writeSubmittalPanelPreferences(storage, { collapsed: { loc: true } });
    expect(readSubmittalPanelPreferences(storage)).toEqual({ ...defaultSubmittalPanelPreferences, collapsed: { loc: true } });
    writeSubmittalPanelPreferences(storage, { width: 960 });
    expect(readSubmittalPanelPreferences(storage)).toEqual({ ...defaultSubmittalPanelPreferences, width: 960, collapsed: { loc: true } });
  });

  it("ignores a kept value of the wrong shape", () => {
    const storage = memoryStorage({ [submittalPanelPreferencesKey]: JSON.stringify({ width: "wide", collapsed: [1], tab: 3 }) });
    expect(readSubmittalPanelPreferences(storage)).toEqual(defaultSubmittalPanelPreferences);
    expect(readSubmittalPanelPreferences(memoryStorage({ [submittalPanelPreferencesKey]: "{not json" }))).toEqual(defaultSubmittalPanelPreferences);
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
    expect(readSubmittalPanelPreferences(throwing)).toEqual(defaultSubmittalPanelPreferences);
    expect(() => writeSubmittalPanelPreferences(throwing, { width: 960 })).not.toThrow();
    expect(readSubmittalPanelPreferences(null)).toEqual(defaultSubmittalPanelPreferences);
  });
});
