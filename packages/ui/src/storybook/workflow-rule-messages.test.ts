import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ruleMessages } from "./workflow-rule-messages.ts";

// The stories' rule words are a copy of the web app's `workflowRules` messages (the
// package has no translations of its own): this keeps the copy from drifting.

const webMessages = (locale: "en" | "ar"): unknown =>
  (JSON.parse(readFileSync(new URL(`../../../../apps/web/messages/${locale}.json`, import.meta.url), "utf8")) as { workflowRules: unknown }).workflowRules;

describe("the stories' rule messages", () => {
  it.each(["en", "ar"] as const)("are the web app's workflowRules messages, in %s", (locale) => {
    expect(ruleMessages[locale]).toEqual(webMessages(locale));
  });
});
