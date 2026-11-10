import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { phone, tablet } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { shellCopy, storySidebar, storyTopBar } from "../../storybook/shell.tsx";
import { AppShell } from "../shell/app-shell.tsx";
import { PageContent } from "../shell/page-frame.tsx";
import { SaveBar } from "./save-bar.tsx";

// A page saved whole from a bar ("No changes", Cancel, Save), as a Member's Visibility is (RP-1276,
// gap-table row 64; the owner's Responsive Review, Visibility on a phone). On a phone the bar is the
// shell's bottom action bar; wider, it sticks to the bottom of the page's content.
const copy = {
  noChanges: { en: "No changes", ar: "لا تغييرات" },
  unsaved: { en: "Unsaved changes", ar: "تغييرات غير محفوظة" },
  saved: { en: "Saved", ar: "حُفظ" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  save: { en: "Save", ar: "حفظ" },
  change: { en: "Make a change", ar: "أجرِ تغييرًا" },
  page: { en: "Omar Haddad's Visibility", ar: "رؤية عمر حداد" },
};

function Page({ context }: { context: StoryContext }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <AppShell sidebar={storySidebar(context)} topBar={storyTopBar(context)} menuLabel={t(shellCopy.menu)} closeLabel={t(shellCopy.close)}>
      <PageContent>
        <h1 className="text-h4 font-semibold">{t(copy.page)}</h1>
        <button type="button" className="mt-4 min-h-11 rounded-md border border-border px-3" onClick={() => (setDirty(true), setSaved(false))}>
          {t(copy.change)}
        </button>
        {/* Tall enough to scroll, as two long cards of Trades and Locations are. */}
        <div className="my-4 h-[150vh] rounded-md border border-dashed border-border-strong" />
        <SaveBar
          status={dirty ? t(copy.unsaved) : saved ? t(copy.saved) : t(copy.noChanges)}
          dirty={dirty}
          cancelLabel={t(copy.cancel)}
          saveLabel={t(copy.save)}
          onCancel={() => setDirty(false)}
          onSave={() => (setDirty(false), setSaved(true))}
        />
      </PageContent>
    </AppShell>
  );
}

const meta = {
  title: "Forms/SaveBar",
  render: (_args, context) => <Page context={context} />,
  parameters: { ...overlay, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const t = (context: PlayContext, text: { en: string; ar: string }) => storyText(context, text);

/** Nothing to save yet, then a change: Cancel and Save turn on; Save says "Saved". */
async function expectSaves(context: PlayContext, bar: HTMLElement) {
  const status = within(bar).getByRole("status");
  const cancel = within(bar).getByRole("button", { name: t(context, copy.cancel) });
  const save = within(bar).getByRole("button", { name: t(context, copy.save) });
  await expect(status).toHaveTextContent(t(context, copy.noChanges));
  await expect(cancel).toBeDisabled();
  await expect(save).toBeDisabled();
  await userEvent.click(context.canvas.getByRole("button", { name: t(context, copy.change) }));
  await expect(status).toHaveTextContent(t(context, copy.unsaved));
  await userEvent.click(save);
  await expect(status).toHaveTextContent(t(context, copy.saved));
  await expect(save).toBeDisabled();
}

/**
 * A phone: the bar is the shell's bottom action bar, stuck to the screen's bottom edge as the page
 * scrolls: "No changes" at the start, Cancel and Save at the end, each 44 high. Nothing scrolls sideways.
 */
export const Phone: Story = {
  parameters: { ...phone, ...overlay, layout: "fullscreen" },
  play: async (context) => {
    const shellBar = context.canvasElement.querySelector<HTMLElement>("[data-action-bar]")!;
    const bar = await waitFor(() => within(shellBar).getByTestId("save-bar"));
    await expect(context.canvas.getByRole("main")).not.toContainElement(bar);
    window.scrollTo(0, 600);
    await waitFor(() => expect(Math.round(shellBar.getBoundingClientRect().bottom)).toBe(innerHeight));
    window.scrollTo(0, 0);
    const rtl = document.documentElement.dir === "rtl";
    const status = within(bar).getByRole("status").getBoundingClientRect();
    const save = within(bar).getByRole("button", { name: t(context, copy.save) }).getBoundingClientRect();
    // "No changes" at the start (the left in English), Save at the end.
    await expect(rtl ? status.left > save.right : status.right < save.left).toBe(true);
    for (const button of within(bar).getAllByRole("button")) await expect(Math.round(button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await expectSaves(context, bar);
  },
};

/** A tablet: no bottom action bar; the save bar is a card stuck to the bottom of the page as it scrolls. */
export const Tablet: Story = {
  parameters: { ...tablet, ...overlay, layout: "fullscreen" },
  play: async (context) => {
    await expect(context.canvasElement.querySelector("[data-action-bar]")).toBeNull();
    const bar = within(context.canvas.getByRole("main")).getByTestId("save-bar");
    await expect(getComputedStyle(bar).position).toBe("sticky");
    window.scrollTo(0, 400);
    await waitFor(() => expect(Math.round(bar.getBoundingClientRect().bottom)).toBe(innerHeight));
    window.scrollTo(0, 0);
    await expectSaves(context, bar);
  },
};
