/**
 * The story test harness. The seam is the Storybook story rendered in a real
 * browser: every story in every *.stories.tsx runs once in English (LTR) and
 * once in Arabic (RTL), and must
 *   1. pass its play function (behaviour: roles, names, keyboard, focus),
 *   2. lay out in the locale's direction, with Latin digits and no deadline words,
 *   3. load nothing from another origin (fonts and icons are self-hosted, no CDN),
 *   4. have no axe violations under WCAG 2.2 AA,
 *   5. in a phone story, give every interactive element a 44 x 44px hit area (inline text
 *      links are exempt; anything else needs `parameters.touchTargets.exempt` with a reason,
 *      see src/storybook/touch-target.ts),
 *   6. match its committed screenshot (Linux only; see vitest.config.ts).
 * Stories with `parameters.phone` render 390px wide on a touch screen
 * (pointer: coarse), so they can check 44px touch targets. Stories with
 * `parameters.overlay` (dialogs, sheets, toasts) leave their overlay open and
 * are screenshotted as a 1024 × 768 page, portals included. Motion is reduced,
 * so animations never reach a screenshot.
 * Update screenshots on purpose with the "update-screenshots" PR label; CI
 * commits the baselines of new stories itself (RP-296).
 */
import { directionOf, locales } from "@rabaed/domain";
import { deadlineWordInCopy } from "@rabaed/eslint-plugin/matchers";
import { composeStories, type composeStory, setProjectAnnotations } from "@storybook/react-vite";
import axe, { type RunOptions } from "axe-core";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { cdp, page } from "vitest/browser";
import preview from "../.storybook/preview.tsx";
import { type TouchTargetExemption, touchTargetOffenders } from "../src/storybook/touch-target.ts";

declare module "vitest" {
  export interface ProvidedContext {
    compareScreenshots: boolean;
  }
}

const annotations = setProjectAnnotations([preview]);
beforeAll(annotations.beforeAll);
beforeAll(() => cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }));

type StoriesModule = Parameters<typeof composeStories>[0];
type ComposedStory = ReturnType<typeof composeStory>;
const modules = import.meta.glob<StoriesModule>("../src/**/*.stories.tsx", { eager: true });

const nonLatinDigits = /[٠-٩۰-۹]/;

const viewports = {
  // Tall, so a long story fits in its element screenshot.
  desktop: { width: 1024, height: 2400 },
  // A screen-sized page, for overlays screenshotted with the page behind them.
  overlay: { width: 1024, height: 768 },
  // A phone with a touch screen (coarse pointer).
  phone: { width: 390, height: 844 },
};

async function emulate(kind: keyof typeof viewports) {
  const { width, height } = viewports[kind];
  if (innerWidth !== width || innerHeight !== height) {
    // Wait for the resize event too: some components (e.g. Select) close their popups on resize.
    const resized = new Promise((resolve) => addEventListener("resize", resolve, { once: true }));
    await page.viewport(width, height);
    await resized;
  }
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: kind === "phone", maxTouchPoints: 5 });
}

for (const locale of locales) {
  describe(locale, () => {
    for (const [file, module] of Object.entries(modules)) {
      const stories = Object.values(composeStories(module, { initialGlobals: { locale } })) as ComposedStory[];

      describe(file.replace("../src/", ""), () => {
        test.each(stories.map((story) => [story.storyName, story] as const))("%s", async (_name, Story) => {
          const overlay = Story.parameters.overlay === true;
          await emulate(Story.parameters.phone === true ? "phone" : overlay ? "overlay" : "desktop");
          const canvasElement = document.createElement("div");
          canvasElement.dataset.testid = "story";
          document.body.append(canvasElement);
          // Record only this story's requests (the buffer holds 250 entries by default).
          performance.clearResourceTimings();

          // Storybook unmounts the previous story at the start of run(), which also removes its
          // portals and undoes what its overlays did to <body>; only then drop its empty canvas.
          await Story.run({ canvasElement });
          for (const stale of document.querySelectorAll("[data-testid=story]")) if (stale !== canvasElement) stale.remove();

          // A story that renders nothing leaves a zero-height root, which cannot be screenshotted
          // ("Could not capture a stable screenshot"). Give only such a root a minimum box (RP-340),
          // so no other story's screenshot changes. The check runs everywhere, not only on Linux.
          if (!overlay && canvasElement.getBoundingClientRect().height === 0) canvasElement.style.minHeight = "2rem";

          expect(document.documentElement.lang).toBe(locale);
          expect(document.documentElement.dir).toBe(directionOf(locale));
          // The whole page, so overlays rendered in portals are checked too.
          const text = document.body.textContent ?? "";
          // Rabaed shows Step Age only: the same words the lint rules ban in message copy.
          expect(deadlineWordInCopy(text)).toBeNull();
          expect(text).not.toMatch(nonLatinDigits);

          // Fonts load as glyphs are laid out; wait for them, then check where everything came from.
          await document.fonts.ready;
          const crossOrigin = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((url) => new URL(url).origin !== location.origin);
          expect(crossOrigin).toEqual([]);

          const { violations } = await axe.run(document.body, (Story.parameters.a11y?.options ?? {}) as RunOptions);
          expect(
            violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`),
          ).toEqual([]);

          if (inject("compareScreenshots")) {
            if (overlay) {
              // The whole viewport, overlays included: a transparent box over it to screenshot
              // (the test iframe's <html> can't be located).
              const frame = document.createElement("div");
              frame.dataset.testid = "viewport";
              frame.setAttribute("aria-hidden", "true");
              frame.style.cssText = "position: fixed; inset: 0; pointer-events: none;";
              document.body.append(frame);
              try {
                await expect.element(page.getByTestId("viewport")).toMatchScreenshot(`${Story.id}--${locale}`);
              } finally {
                frame.remove();
              }
            } else {
              await expect.element(page.getByTestId("story")).toMatchScreenshot(`${Story.id}--${locale}`);
            }
          }

          // Last, because probing a hit area scrolls the page: restore the scroll afterwards.
          if (Story.parameters.phone === true) {
            const exempt = (Story.parameters.touchTargets?.exempt ?? []) as TouchTargetExemption[];
            const { scrollX, scrollY } = window;
            // The app lays pages out inside a 24px gutter (`main`'s px-6), so a story's content is measured
            // inside it too; what sits on the real screen edge (fixed bars, sheets) is measured there.
            canvasElement.style.paddingInline = "1.5rem";
            const offenders = touchTargetOffenders(document.body, exempt);
            window.scrollTo(scrollX, scrollY);
            expect(offenders).toEqual([]);
          }
        });
      });
    }
  });
}
