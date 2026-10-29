import { CHAT_MESSAGE_MAX_LENGTH, type ChatAuthor } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalPanelChatAuthor, submittalPanelChatDraft, submittalPanelChatOpen, submittalPanelChatSends } from "./panel-chat-model.ts";

// A name in both languages, built as data (the package has no translations of its own).
const b = (en: string, ar: string = en) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };

describe("when Chat opens", () => {
  it("is closed until the item's Submission Date", () => {
    expect(submittalPanelChatOpen(null)).toBe(false);
  });

  it("is open from the Submission Date on", () => {
    expect(submittalPanelChatOpen("2026-10-20T08:00:00.000Z")).toBe(true);
  });
});

describe("the composer's keys", () => {
  const key = (k: string, shiftKey = false, isComposing = false) => ({ key: k, shiftKey, isComposing });

  it("sends on Enter", () => {
    expect(submittalPanelChatSends(key("Enter"))).toBe(true);
  });

  it("adds a line on Shift+Enter", () => {
    expect(submittalPanelChatSends(key("Enter", true))).toBe(false);
  });

  it("never sends while an input method is still composing (Arabic and other IMEs confirm with Enter)", () => {
    expect(submittalPanelChatSends(key("Enter", false, true))).toBe(false);
  });

  it("sends on no other key", () => {
    expect(submittalPanelChatSends(key("a"))).toBe(false);
  });
});

describe("what the composer holds", () => {
  it("is ready to send with text once trimmed", () => {
    expect(submittalPanelChatDraft("  Please confirm the sample.  ")).toBe("ready");
  });

  it("is empty with only spaces and new lines", () => {
    expect(submittalPanelChatDraft(" \n\t ")).toBe("empty");
    expect(submittalPanelChatDraft("")).toBe("empty");
  });

  it("holds at most the longest message, counted in characters (an emoji is one), once trimmed", () => {
    expect(submittalPanelChatDraft(`  ${"😀".repeat(CHAT_MESSAGE_MAX_LENGTH)}  `)).toBe("ready");
    expect(submittalPanelChatDraft("a".repeat(CHAT_MESSAGE_MAX_LENGTH + 1))).toBe("too_long");
  });
});

describe("how a message's author is shown (V14)", () => {
  const consultant = { baseRole: "consultant" as const, name: b("Consultant", "الاستشاري") };
  const contractor = { baseRole: "contractor" as const, name: b("Main Contractor", "المقاول الرئيسي") };

  it("names your own Company's author, with the Company and Project Role", () => {
    const own: ChatAuthor = { kind: "own", memberName: b("Sara Al-Otaibi", "سارة العتيبي"), companyName: b("Dar Consult", "دار للاستشارات"), projectRole: consultant };
    expect(submittalPanelChatAuthor(own, "en")).toEqual({ person: "Sara Al-Otaibi", company: "Dar Consult", role: "Consultant", baseRole: "consultant" });
    expect(submittalPanelChatAuthor(own, "ar")).toEqual({ person: "سارة العتيبي", company: "دار للاستشارات", role: "الاستشاري", baseRole: "consultant" });
  });

  it("shows another Company's author as its Company name and Project Role only", () => {
    const other: ChatAuthor = { kind: "other", companyName: b("TMC Constructions", "تي إم سي للمقاولات"), projectRole: contractor };
    expect(submittalPanelChatAuthor(other, "en")).toEqual({ person: null, company: "TMC Constructions", role: "Main Contractor", baseRole: "contractor" });
  });

  it("never names a person of another Company, even if a name came with it", () => {
    const leaked = { kind: "other", memberName: b("Hafiz Rahman"), companyName: b("TMC Constructions"), projectRole: contractor } as ChatAuthor;
    expect(submittalPanelChatAuthor(leaked, "en").person).toBeNull();
  });
});
