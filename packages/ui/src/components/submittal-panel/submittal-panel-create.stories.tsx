import type { Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { SubmittalPanelGrip, SubmittalPanelSizeSwitch, useSubmittalPanelSize, type SubmittalPanelSizeLabels } from "./panel-resize.tsx";
import { NewItemIdentity } from "./new-item.tsx";
import { SubmittalPanel, type SubmittalPanelLayout, type SubmittalPanelLabels } from "./submittal-panel.tsx";

// The Submittal Panel in create mode and its tablet and phone layouts (RP-1152 rows 1, 6, 7, 9).

const copy = {
  module: { en: "Submittals", ar: "التقديمات" },
  crumb: { en: "New Material Approval Request", ar: "طلب اعتماد مواد جديد" },
  previous: { en: "Previous submittal", ar: "التقديم السابق" },
  next: { en: "Next submittal", ar: "التقديم التالي" },
  close: { en: "Close", ar: "إغلاق" },
  back: { en: "Back to Submittals", ar: "العودة إلى التقديمات" },
  hint: { en: "Esc to close", ar: "Esc للإغلاق" },
  saveDraft: { en: "Save Draft", ar: "حفظ المسودة" },
  open: { en: "New", ar: "جديد" },
  subject: { en: "Subject", ar: "الموضوع" },
};

const sizeLabels = (locale: Locale): SubmittalPanelSizeLabels => ({
  group: locale === "ar" ? "الحجم" : "Size",
  sizes: locale === "ar" ? { compact: "مضغوط", normal: "عادي", wide: "عريض", full: "كامل" } : { compact: "Compact", normal: "Normal", wide: "Wide", full: "Full" },
  grip: locale === "ar" ? "اسحب لتغيير الحجم" : "Drag to resize",
});

const labels = (locale: Locale): SubmittalPanelLabels => ({
  module: copy.module[locale],
  position: (n, total) => `${n} / ${total}`,
  previous: copy.previous[locale],
  next: copy.next[locale],
  close: copy.close[locale],
  hint: copy.hint[locale],
  back: copy.back[locale],
});

function CreateDemo({ context, layout = "slide-over", focusSubject = false }: { context: StoryContext; layout?: SubmittalPanelLayout; focusSubject?: boolean }) {
  const locale = storyLocale(context);
  const [open, setOpen] = useState(true);
  const size = useSubmittalPanelSize({ initial: 960, dir: locale === "ar" ? "rtl" : "ltr" });
  return (
    <div className="p-4">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {copy.open[locale]}
      </Button>
      {open && (
        <SubmittalPanel
          locale={locale}
          labels={labels(locale)}
          mode="create"
          layout={layout}
          crumb={copy.crumb[locale]}
          label={copy.crumb[locale]}
          onClose={() => setOpen(false)}
          width={size.width}
          resizing={size.resizing}
          edge={<SubmittalPanelGrip size={size} locale={locale} labels={sizeLabels(locale)} />}
          topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels(locale)} />}
          actions={<Button>{copy.saveDraft[locale]}</Button>}
          identity={
            focusSubject ? (
              <NewItemIdentity
                locale={locale}
                noNumber={locale === "ar" ? "بلا رقم بعد" : "No number yet"}
                draft={locale === "ar" ? "مسودة" : "Draft"}
                subject=""
                onSubjectChange={() => {}}
                subjectLabel={copy.subject[locale]}
                focusSubject
              />
            ) : undefined
          }
        >
          <p className="p-5">{locale === "ar" ? "أقسام النموذج" : "Form Sections"}</p>
        </SubmittalPanel>
      )}
    </div>
  );
}

const meta = {
  title: "Views/Submittal Panel/Create mode",
  parameters: overlay,
  render: (_args, context) => <CreateDemo context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");

/**
 * Create mode on desktop (rows 1, 9): the breadcrumb names the new item, with no "n / total" and
 * no previous or next; ↑ and ↓ do nothing; the grip and size switch stay; Esc closes.
 */
export const Create: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await expect(panel).toHaveAccessibleName(storyText(context, copy.crumb));
    await expect(panel.querySelector(".sdp-crumb")).toHaveTextContent(storyText(context, copy.crumb));
    await expect(panel.querySelector(".sdp-crumb")).not.toHaveTextContent("/");
    await expect(within(panel).queryByRole("button", { name: storyText(context, copy.previous) })).toBeNull();
    await expect(within(panel).queryByRole("button", { name: storyText(context, copy.next) })).toBeNull();
    await expect(panel.querySelector(".sdp-grip")).not.toBeNull();
    await expect(within(panel).getByRole("group", { name: storyText(context, { en: "Size", ar: "الحجم" }) })).toBeVisible();

    await expect(panel).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    await expect(panelOf(context)).toBe(panel);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(context.canvasElement).queryByRole("dialog")).toBeNull());
  },
};

/**
 * A panel that clears after each save opens again with the focus in its Subject (RP-1222 row 10):
 * the panel moves focus in only when nothing inside it holds it already.
 */
export const CreateFocusInTheSubject: Story = {
  render: (_args, context) => <CreateDemo context={context} focusSubject />,
  play: async (context) => {
    await expect(within(panelOf(context)).getByRole("textbox", { name: storyText(context, copy.subject) })).toHaveFocus();
  },
};

/** The tablet (row 6): the whole width, with no drag edge; the size switch stays. */
export const TabletFull: Story = {
  render: (_args, context) => <CreateDemo context={context} layout="tablet-full" />,
  play: async (context) => {
    const panel = panelOf(context);
    const box = panel.getBoundingClientRect();
    await expect(box.width).toBe(document.documentElement.clientWidth);
    await expect(panel.querySelector(".sdp-grip")).toBeNull();
    await expect(within(panel).getByRole("button", { name: storyText(context, copy.close) })).toBeVisible();
  },
};

/**
 * The phone (row 7): a full page; a back arrow in place of Close; no size switch and no grip; the
 * footer fixed at the bottom of the screen.
 */
export const PhonePage: Story = {
  parameters: { phone: true },
  render: (_args, context) => <CreateDemo context={context} layout="page" />,
  play: async (context) => {
    const panel = panelOf(context);
    const box = panel.getBoundingClientRect();
    await expect(box.width).toBe(document.documentElement.clientWidth);
    await expect(box.height).toBe(innerHeight);
    await expect(within(panel).queryByRole("button", { name: storyText(context, copy.close) })).toBeNull();
    await expect(within(panel).queryByRole("group", { name: storyText(context, { en: "Size", ar: "الحجم" }) })).toBeNull();
    await expect(panel.querySelector(".sdp-grip")).toBeNull();
    const back = within(panel).getByRole("button", { name: storyText(context, copy.back) });
    // The back arrow comes first, before the title.
    await expect(panel.querySelector(".sdp-top button")).toBe(back);
    await expect(panel.querySelector(".sdp-actions")!.getBoundingClientRect().bottom).toBe(innerHeight);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await userEvent.click(back);
    await waitFor(() => expect(within(context.canvasElement).queryByRole("dialog")).toBeNull());
  },
};
