/**
 * The story test harness. The seam is the Storybook story rendered in a real
 * browser: every story in every *.stories.tsx runs once in English (LTR) and
 * once in Arabic (RTL), and must
 *   1. pass its play function (behaviour: roles, names, keyboard, focus),
 *   2. lay out in the locale's direction, with Latin digits and no deadline words,
 *   3. load nothing from another origin (fonts and icons are self-hosted, no CDN),
 *   4. have no axe violations under WCAG 2.2 AA,
 *   5. match its committed screenshot (Linux only; see vitest.config.ts).
 * Stories with `parameters.phone` render 390px wide on a touch screen
 * (pointer: coarse), so they can check 44px touch targets.
 * Update screenshots on purpose with the "update-screenshots" PR label.
 */
import { directionOf, locales } from "@rabaed/domain";
import { composeStories, type composeStory, setProjectAnnotations } from "@storybook/react-vite";
import axe, { type RunOptions } from "axe-core";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { cdp, page } from "vitest/browser";
import preview from "../.storybook/preview.tsx";

declare module "vitest" {
  export interface ProvidedContext {
    compareScreenshots: boolean;
  }
}

const annotations = setProjectAnnotations([preview]);
beforeAll(annotations.beforeAll);

type StoriesModule = Parameters<typeof composeStories>[0];
type ComposedStory = ReturnType<typeof composeStory>;
const modules = import.meta.glob<StoriesModule>("../src/**/*.stories.tsx", { eager: true });

// Rabaed shows Step Age only: never due dates, deadlines or lateness (CONTEXT.md).
const deadlineWords = /overdue|\bdue\b|deadline|\blate\b|\bSLA\b|متأخر|موعد نهائي|تاريخ الاستحقاق/i;
const nonLatinDigits = /[٠-٩۰-۹]/;

/** A phone (390px, touch screen, coarse pointer) or the default desktop viewport. */
async function emulatePhone(on: boolean) {
  const width = on ? 390 : 1024;
  if (innerWidth !== width) {
    // Wait for the resize event too: some components (e.g. Select) close their popups on resize.
    const resized = new Promise((resolve) => addEventListener("resize", resolve, { once: true }));
    await page.viewport(width, on ? 844 : 2400);
    await resized;
  }
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: on, maxTouchPoints: 5 });
}

for (const locale of locales) {
  describe(locale, () => {
    for (const [file, module] of Object.entries(modules)) {
      const stories = Object.values(composeStories(module, { initialGlobals: { locale } })) as ComposedStory[];

      describe(file.replace("../src/", ""), () => {
        test.each(stories.map((story) => [story.storyName, story] as const))("%s", async (_name, Story) => {
          await emulatePhone(Story.parameters.phone === true);
          const canvasElement = document.createElement("div");
          canvasElement.dataset.testid = "story";
          document.body.replaceChildren(canvasElement);
          // Record only this story's requests (the buffer holds 250 entries by default).
          performance.clearResourceTimings();

          await Story.run({ canvasElement });

          expect(document.documentElement.lang).toBe(locale);
          expect(document.documentElement.dir).toBe(directionOf(locale));
          const text = canvasElement.textContent ?? "";
          expect(text).not.toMatch(deadlineWords);
          expect(text).not.toMatch(nonLatinDigits);

          // Fonts load as glyphs are laid out; wait for them, then check where everything came from.
          await document.fonts.ready;
          const crossOrigin = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((url) => new URL(url).origin !== location.origin);
          expect(crossOrigin).toEqual([]);

          const { violations } = await axe.run(canvasElement, (Story.parameters.a11y?.options ?? {}) as RunOptions);
          expect(
            violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`),
          ).toEqual([]);

          if (inject("compareScreenshots")) {
            await expect.element(page.getByTestId("story")).toMatchScreenshot(`${Story.id}--${locale}`);
          }
        });
      });
    }
  });
}
