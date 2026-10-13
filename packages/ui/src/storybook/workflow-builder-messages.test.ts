import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatIcu } from "./icu.ts";
import { builderMessages } from "./workflow-builder-messages.ts";

// The stories' builder words are a copy of the web app's messages (the package has no
// translations of its own): this keeps the copy from drifting, and checks the stories'
// small ICU formatter reads the plurals as next-intl does.

type Messages = { workflowBuilder: unknown; workflowMap: unknown; projects: { roles: unknown } };
const web = (locale: "en" | "ar"): Messages => JSON.parse(readFileSync(new URL(`../../../../apps/web/messages/${locale}.json`, import.meta.url), "utf8")) as Messages;

describe("the stories' builder messages", () => {
  it.each(["en", "ar"] as const)("are the web app's workflowBuilder, workflowMap and projects.roles messages, in %s", (locale) => {
    const m = web(locale);
    expect(builderMessages[locale]).toEqual({ workflowBuilder: m.workflowBuilder, workflowMap: m.workflowMap, roles: m.projects.roles });
  });

  it("formats the counts with each language's plurals", () => {
    const counts = (locale: "en" | "ar", steps: number, transitions: number) =>
      formatIcu(builderMessages[locale].workflowBuilder.counts, { steps, stepsN: String(steps), transitions, transitionsN: String(transitions) }, locale);
    expect(counts("en", 1, 15)).toBe("1 Step · 15 Transitions");
    expect(counts("en", 6, 1)).toBe("6 Steps · 1 Transition");
    expect(counts("ar", 6, 15)).toBe("6 خطوات · 15 انتقالًا");
    expect(counts("ar", 2, 12)).toBe("خطوتان · 12 انتقالًا");
  });
});
