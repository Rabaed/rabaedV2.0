import type { ChecklistAnswers, ChecklistField as ChecklistFieldSchema, ChecklistTemplateItem } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { ChecklistField } from "./checklist-field.tsx";

// The "Raise a Snag" tick (RP-577, INSP-5; form-engine.md §3.3): a WIR's checklist copied from a
// Checklist Template, as the Consultant Engineer answers it in the reply Screen (RP-86). An item
// whose template says `create_snag` shows "Raise a Snag" once answered Fail or No, ticked by
// default; unticking it keeps the item from becoming a Snag when the code is issued. An item that
// raises none never shows it. Story data only.
const items: ChecklistTemplateItem[] = [
  {
    key: "formwork",
    text: { en: "Formwork is clean and tight", ar: "الشدة نظيفة ومحكمة" },
    answers: "pass_fail_na",
    comment: "optional",
    photo: "off",
    on_negative: "create_snag",
  },
  {
    key: "permit_on_site",
    text: { en: "Pour permit is on site", ar: "تصريح الصب موجود في الموقع" },
    answers: "yes_no_na",
    comment: "off",
    photo: "off",
    on_negative: "none",
  },
];
const field: ChecklistFieldSchema = {
  key: "inspection_checklist",
  type: "checklist",
  label: { en: "Checklist", ar: "قائمة التحقق" },
  required: true,
  items,
};

const copy = {
  formwork: { en: "Formwork is clean and tight", ar: "الشدة نظيفة ومحكمة" },
  permit: { en: "Pour permit is on site", ar: "تصريح الصب موجود في الموقع" },
  pass: { en: "Pass", ar: "مطابق" },
  fail: { en: "Fail", ar: "غير مطابق" },
  no: { en: "No", ar: "لا" },
  raiseSnag: { en: "Raise a Snag", ar: "إنشاء عيب" },
  snagRaised: { en: "A Snag is raised with the code", ar: "يُنشأ عيب مع الرمز" },
  noSnagRaised: { en: "No Snag is raised", ar: "لا يُنشأ عيب" },
  ticked: { en: "Becomes a Snag for the Contractor when the code is issued.", ar: "يصبح عيبًا على المقاول عند إصدار الرمز." },
  unticked: { en: "Unticked: for example a minor failure fixed on the spot.", ar: "غير محدد: مثلًا خلل بسيط أُصلح في الموقع." },
  addComment: { en: "Add comment", ar: "إضافة تعليق" },
  saved: { en: "Saved", ar: "حُفظ" },
};

const meta = {
  title: "Form engine/Checklist field/Raise a Snag",
  component: ChecklistField,
  args: { field, value: {}, mode: "edit", locale: "en", labels: formRendererLabels.en.checklist, onChange: fn() },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
  render: function Render(args, context) {
    const [value, setValue] = useState<unknown>(args.value);
    const locale = storyLocale(context);
    return (
      <ChecklistField
        {...args}
        locale={locale}
        labels={formRendererLabels[locale].checklist}
        value={value}
        onChange={(next) => {
          args.onChange?.(next);
          setValue(next);
        }}
      />
    );
  },
} satisfies Meta<typeof ChecklistField>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** One item's card, found by its answers' group name (the item's text). */
const itemOf = (context: PlayContext, name: Record<"en" | "ar", string>) =>
  within(context.canvas.getByRole("radiogroup", { name: storyText(context, name) }).closest("li")!);

/** A Fail shows the tick, ticked; unticking saves `snag: false`, ticking again drops it; a Pass hides it; an item raising none never shows it. */
export const Answering: Story = {
  play: async (context) => {
    const formwork = itemOf(context, copy.formwork);
    const tick = () => formwork.queryByRole("checkbox", { name: storyText(context, copy.raiseSnag) });
    await expect(tick()).toBeNull();
    await userEvent.click(formwork.getByRole("radio", { name: storyText(context, copy.fail) }));
    await expect(tick()).toBeChecked();
    // Its help says what the tick does, and why one may untick it (RP-655).
    await expect(tick()).toHaveAccessibleDescription(storyText(context, copy.ticked));
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ formwork: { answer: "fail" } });
    await userEvent.click(tick()!);
    await expect(tick()).not.toBeChecked();
    await expect(tick()).toHaveAccessibleDescription(storyText(context, copy.unticked));
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ formwork: { answer: "fail", snag: false } });
    await userEvent.click(tick()!);
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ formwork: { answer: "fail" } });
    await userEvent.click(formwork.getByRole("radio", { name: storyText(context, copy.pass) }));
    await expect(tick()).toBeNull();

    const permit = itemOf(context, copy.permit);
    await userEvent.click(permit.getByRole("radio", { name: storyText(context, copy.no) }));
    await expect(permit.queryByRole("checkbox")).toBeNull();
  },
};

/** Unticked before: a saved `snag: false` shows unticked, and a comment typed after keeps it. */
export const Unticked: Story = {
  args: { value: { formwork: { answer: "fail", snag: false } } },
  play: async (context) => {
    const formwork = itemOf(context, copy.formwork);
    await expect(formwork.getByRole("checkbox", { name: storyText(context, copy.raiseSnag) })).not.toBeChecked();
    // An optional comment opens from its link (RP-655).
    await userEvent.click(formwork.getByRole("button", { name: storyText(context, copy.addComment) }));
    await userEvent.type(formwork.getByRole("textbox"), "Gap");
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ formwork: { answer: "fail", snag: false, comment: "Gap" } });
  },
};

/** Read, as the Manager's code pop-up shows it: whether each failed item raises a Snag. */
export const Read: Story = {
  args: { mode: "read", value: { formwork: { answer: "fail", comment: "Gap at the joint" }, permit_on_site: { answer: "no" } } },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryByRole("checkbox")).toBeNull();
    await expect(canvas.getByText(storyText(context, copy.snagRaised))).toBeVisible();
    await expect(canvas.queryByText(storyText(context, copy.noSnagRaised))).toBeNull();
  },
};

/**
 * On a WIR's page (RP-655): only the items a filter chip shows, numbered as in the whole checklist,
 * each card ending with the page's own line (whether its answer is saved), and no summary line,
 * which the page's bar shows.
 */
export const OnTheWirPage: Story = {
  args: {
    value: { formwork: { answer: "pass" } },
    shown: new Set(["permit_on_site"]),
    summary: false,
    itemFooter: (key: string) => <p>{`${key}: ${copy.saved.en}`}</p>,
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryByRole("radiogroup", { name: storyText(context, copy.formwork) })).toBeNull();
    const permit = itemOf(context, copy.permit);
    await expect(permit.getByText(`permit_on_site: ${copy.saved.en}`)).toBeVisible();
    await expect(permit.getByText("2", { exact: true })).toBeVisible();
    await expect(canvas.queryByRole("status")).toBeNull();
  },
};

/** Read, unticked: the failed item says no Snag is raised. */
export const ReadUnticked: Story = {
  args: { mode: "read", value: { formwork: { answer: "fail", snag: false } } as ChecklistAnswers },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.noSnagRaised))).toBeVisible();
    await expect(context.canvas.queryByText(storyText(context, copy.snagRaised))).toBeNull();
  },
};
