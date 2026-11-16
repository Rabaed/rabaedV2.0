/**
 * RP-1313: on the Package page, "+ Add submittals" is the page's primary action until the Package can be
 * Submitted, then a secondary one beside Rename while Submit Package takes the phone's bottom bar (RP-1292).
 * When that flips (items added, so the page refreshes), the button is the same node and keeps its focus, at
 * the phone width (from the bar to the header) and at 820 (in the header both times). The Package page's
 * stories, re-rendered with the submittable Package, in a real Chromium, in English and Arabic.
 */
import { locales } from "@rabaed/domain";
import { composeStories, type composeStory, setProjectAnnotations } from "@storybook/react-vite";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import preview from "../.storybook/preview.tsx";
import * as packagePageStories from "../src/components/packages/package-page.stories.tsx";
import { packagePageLabels } from "../src/storybook/packages.ts";

const annotations = setProjectAnnotations([preview]);
beforeAll(annotations.beforeAll);

// The owner's iPad Air portrait and iPhone, as in stories.test.tsx.
const tablet = { width: 820, height: 1180 };
const phone = { width: 402, height: 874 };

async function resize({ width, height }: { width: number; height: number }) {
  if (innerWidth === width && innerHeight === height) return;
  const resized = new Promise((resolve) => addEventListener("resize", resolve, { once: true }));
  await page.viewport(width, height);
  await resized;
}

const actionBar = () => document.querySelector<HTMLElement>("[data-action-bar]");
const headerActions = (label: string) => document.querySelector<HTMLElement>(`main [role="group"][aria-label="${label}"]`);

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

for (const locale of locales) {
  describe(locale, () => {
    // As stories.test.tsx does: the module's typed decorator doesn't fit composeStories' loose one.
    const stories = composeStories(packagePageStories as unknown as Parameters<typeof composeStories>[0], { initialGlobals: { locale } }) as Record<
      string,
      ReturnType<typeof composeStory>
    >;
    const NotSubmittableOnAPhone = stories.NotSubmittableOnAPhone!;
    const l = packagePageLabels[locale];
    const submittable = packagePageStories.OnAPhone.args!.pkg;

    const button = (where: HTMLElement | null, name: string) =>
      [...(where?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes(name)) ?? null;

    /** The Package that can't be Submitted yet, then the same page re-rendered with one that can. */
    async function flip(size: typeof phone, before: () => HTMLElement | null, after: () => HTMLElement | null) {
      await resize(size);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      cleanup = () => {
        root.unmount();
        container.remove();
      };
      root.render(<NotSubmittableOnAPhone />);
      await expect.poll(() => button(before(), l.addItems.trigger)).not.toBeNull();
      const add = button(before(), l.addItems.trigger)!;
      add.focus();
      await expect(document.activeElement).toBe(add);

      root.render(<NotSubmittableOnAPhone pkg={submittable} />);
      // Submit Package is offered, then "+ Add submittals" is where it now belongs.
      await expect.poll(() => button(document.body, l.submit.trigger)).not.toBeNull();
      await expect.poll(() => button(after(), l.addItems.trigger)).toBe(add);
      await expect(add.isConnected).toBe(true);
      await expect(add.checkVisibility()).toBe(true);
      await expect(document.activeElement).toBe(add);
    }

    test("at the phone width, it moves from the bottom bar to the header as the same button, still focused", async () => {
      await flip(phone, actionBar, () => headerActions(l.actions));
      // The bar holds Submit Package only.
      const bar = actionBar()!;
      await expect(button(bar, l.submit.trigger)).not.toBeNull();
      await expect(bar.querySelectorAll("button")).toHaveLength(1);
    });

    test("at 820, it stays in the header as the same button, still focused", async () => {
      const header = () => headerActions(l.actions);
      await flip(tablet, header, header);
      await expect(actionBar()).toBeNull();
    });
  });
}
