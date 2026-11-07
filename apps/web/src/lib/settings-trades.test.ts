import { describe, expect, it } from "vitest";
import { listedTrades, tradeOptions, type SettingsTrade } from "./settings-trades.ts";

const trade = (id: string, active: boolean): SettingsTrade => ({ id, code: id.toUpperCase(), name: { en: `${id} en`, ar: `${id} ar` }, active });
const trades = [trade("el", true), trade("me", false), trade("pl", false)];

describe("tradeOptions (RP-1251)", () => {
  it("offers no deactivated Trade for a new choice", () => {
    expect(tradeOptions(trades, "en", "Archived")).toEqual([{ value: "el", label: "el en" }]);
  });

  it("keeps a record's own deactivated Trade, labelled with the screen's word, and no other deactivated one", () => {
    expect(tradeOptions(trades, "ar", "مؤرشف", "me")).toEqual([
      { value: "el", label: "el ar" },
      { value: "me", label: "me ar (مؤرشف)" },
    ]);
  });
});

describe("listedTrades (RP-1251)", () => {
  it("gives every active Trade a card, and a deactivated one only while a record on it is listed", () => {
    expect(listedTrades(trades, ["pl"]).map((t) => t.id)).toEqual(["el", "pl"]);
    expect(listedTrades(trades, []).map((t) => t.id)).toEqual(["el"]);
  });
});
