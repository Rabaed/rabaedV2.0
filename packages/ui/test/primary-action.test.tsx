/**
 * RP-1290: a page's primary action moves between the page header (tablet, desktop) and the phone's bottom bar
 * as the window crosses the phone width, e.g. a tablet turned. A dialog it opened stays open, with what was
 * typed. The AppShell story `PrimaryActionDialog` ("+ New Package"), in a real Chromium as the story harness,
 * in English and Arabic; a story can't resize the window, so this file does.
 */
import { locales } from "@rabaed/domain";
import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import preview from "../.storybook/preview.tsx";
import * as appShellStories from "../src/components/shell/app-shell.stories.tsx";
import { packagesBoardLabels } from "../src/storybook/packages.ts";

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
const pageHeader = (within: ParentNode = document) => within.querySelector<HTMLElement>("main [data-page-header]");

for (const locale of locales) {
  describe(locale, () => {
    const { PrimaryActionDialog } = composeStories(appShellStories, { initialGlobals: { locale } });
    const l = packagesBoardLabels[locale].create;
    // Both names, whatever the page's language: the Arabic one is typed in Arabic.
    const typed = { en: "Fire Fighting", ar: "مكافحة الحريق" };

    /** The trigger, wherever it is: the dialog hides the page from the accessibility tree, so found by its text. */
    const trigger = (where: HTMLElement | null) =>
      [...(where?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes(l.trigger)) ?? null;

    /** The story at 820 (its play checks the action is in the page header there). */
    async function mount() {
      await resize(tablet);
      const canvasElement = document.createElement("div");
      document.body.append(canvasElement);
      await PrimaryActionDialog.run({ canvasElement });
    }

    async function openAndType() {
      await userEvent.click(page.getByRole("button", { name: l.trigger }));
      await userEvent.fill(page.getByRole("dialog", { name: l.title }).getByLabelText(l.nameEn, { exact: false }), typed.en);
      await userEvent.fill(page.getByRole("dialog", { name: l.title }).getByLabelText(l.nameAr, { exact: false }), typed.ar);
    }

    async function expectStillTyped() {
      const dialog = page.getByRole("dialog", { name: l.title });
      await expect.element(dialog).toBeVisible();
      await expect.element(dialog.getByLabelText(l.nameEn, { exact: false })).toHaveValue(typed.en);
      await expect.element(dialog.getByLabelText(l.nameAr, { exact: false })).toHaveValue(typed.ar);
    }

    test("the server's markup hydrated at 820 keeps the action in the page header", async () => {
      await resize(tablet);
      const container = document.createElement("div");
      document.body.append(container);
      container.innerHTML = renderToString(<PrimaryActionDialog />);
      // An effect runs only once hydration has committed; the render that follows it lands by the next frames.
      let committed!: () => void;
      const hydration = new Promise<void>((resolve) => (committed = resolve));
      function Hydrated({ children }: { children: ReactNode }) {
        useEffect(() => committed(), []);
        return children;
      }
      const root = hydrateRoot(
        container,
        <Hydrated>
          <PrimaryActionDialog />
        </Hydrated>,
      );
      try {
        await hydration;
        for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
        await expect(trigger(pageHeader(container))?.checkVisibility()).toBe(true);
      } finally {
        root.unmount();
        container.remove();
      }
    });

    test("an open dialog keeps what was typed when a tablet turns to the phone width and back", async () => {
      await mount();
      await openAndType();
      await resize(phone);
      // The trigger has moved to the bottom bar under the open dialog, which kept its names.
      await expect.poll(() => trigger(actionBar())).not.toBeNull();
      await expectStillTyped();

      await resize(tablet);
      await expect.poll(() => trigger(pageHeader())).not.toBeNull();
      await expectStillTyped();

      // Closed, focus goes back to the trigger where it now is.
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByRole("dialog", { name: l.title })).not.toBeInTheDocument();
      await expect.poll(() => document.activeElement).toBe(trigger(pageHeader()));
    });

    test("an open dialog keeps what was typed when a phone turns to the tablet width", async () => {
      await mount();
      await resize(phone);
      await expect.poll(() => trigger(actionBar())).not.toBeNull();

      // Opened from the bottom bar.
      await openAndType();
      await resize(tablet);
      await expect.poll(() => trigger(pageHeader())).not.toBeNull();
      await expectStillTyped();
      // No empty bar left behind at the tablet width.
      await expect(actionBar()).toBeNull();
    });
  });
}
