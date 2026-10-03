import { formSchema, validateAnswers, type FieldError } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// Layout fields and conditions (RP-267). Story data only: real Forms are published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "sample",
      title: { en: "Sample", ar: "العينة" },
      fields: [
        { key: "sample_heading", type: "heading", text: { en: "About the sample", ar: "عن العينة" } },
        {
          key: "sample_note",
          type: "instructions",
          text: { en: "Send the sample to site before the review.", ar: "أرسل العينة إلى الموقع قبل المراجعة." },
        },
        { key: "sample_provided", type: "yes_no", required: true, label: { en: "Sample provided", ar: "تم تقديم عينة" } },
        {
          key: "sample_reference",
          type: "text",
          required: true,
          visible_if: { field: "sample_provided", op: "=", value: true },
          label: { en: "Sample reference", ar: "مرجع العينة" },
        },
        { key: "sample_divider", type: "divider" },
        {
          key: "finish",
          type: "select",
          label: { en: "Finish", ar: "التشطيب" },
          options: [
            { value: "galvanised", label: { en: "Galvanised", ar: "مجلفن" } },
            { value: "other", label: { en: "Other", ar: "أخرى" } },
          ],
        },
        {
          key: "finish_details",
          type: "text",
          required: { field: "finish", op: "=", value: "other" },
          label: { en: "Finish details", ar: "تفاصيل التشطيب" },
        },
      ],
    },
    {
      key: "lab",
      title: { en: "Lab test", ar: "الاختبار المعملي" },
      visible_if: { field: "sample_provided", op: "=", value: true },
      fields: [{ key: "lab_name", type: "text", required: true, label: { en: "Lab", ar: "المختبر" } }],
    },
  ],
});

const copy = {
  heading: { en: "About the sample", ar: "عن العينة" },
  note: { en: "Send the sample to site before the review.", ar: "أرسل العينة إلى الموقع قبل المراجعة." },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
  reference: { en: "Sample reference", ar: "مرجع العينة" },
  labSection: { en: "Lab test", ar: "الاختبار المعملي" },
  finish: { en: "Finish", ar: "التشطيب" },
  other: { en: "Other", ar: "أخرى" },
  details: { en: "Finish details", ar: "تفاصيل التشطيب" },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
};

const meta = {
  title: "Form engine/FormRenderer/Conditions and layout",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en" },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const field = (context: PlayContext, label: { en: string; ar: string }) =>
  // Not exact: a required field's label ends with its (visual) asterisk.
  context.canvas.queryByLabelText(storyText(context, label), { exact: false });
const region = (context: PlayContext, label: { en: string; ar: string }) =>
  context.canvas.queryByRole("region", { name: storyText(context, label) });

/** Fields and a section appear when they apply and go when they don't; a field turns required when its condition holds. */
export const Edit: Story = {
  render: function Render(args, context) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<FieldError[]>([]);
    return (
      <FormRenderer
        {...args}
        locale={storyLocale(context)}
        answers={values}
        errors={errors}
        onChange={(changes) => {
          const next = { ...values, ...changes };
          setValues(next);
          const checked = validateAnswers(schema, next, "draft");
          setErrors(checked.ok ? [] : checked.errors);
        }}
      />
    );
  },
  play: async (context) => {
    const { canvas } = context;
    // Layout: a heading under the section's, instructions, a divider.
    await expect(canvas.getByRole("heading", { level: 4, name: storyText(context, copy.heading) })).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.note))).toBeVisible();
    await expect(canvas.getByRole("separator")).toBeInTheDocument();

    await expect(field(context, copy.reference)).toBeNull();
    await expect(region(context, copy.labSection)).toBeNull();

    await userEvent.click(canvas.getByRole("radio", { name: storyText(context, copy.yes) }));
    const reference = field(context, copy.reference)!;
    await expect(reference).toBeVisible();
    await expect(reference).toBeRequired();
    await expect(region(context, copy.labSection)).toBeVisible();
    await userEvent.type(reference, "S-1");

    await userEvent.click(canvas.getByRole("radio", { name: storyText(context, copy.no) }));
    await expect(field(context, copy.reference)).toBeNull();
    await expect(region(context, copy.labSection)).toBeNull();

    // Shown always; required only for "Other".
    await expect(field(context, copy.details)).not.toBeRequired();
    await userEvent.click(canvas.getByRole("combobox", { name: storyText(context, copy.finish) }));
    await userEvent.click(await screen.findByRole("option", { name: storyText(context, copy.other) }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(field(context, copy.details)).toBeRequired();
  },
};

/** An error on a hidden field is neither shown nor counted: only shown fields can be fixed. */
export const WithErrors: Story = {
  args: {
    answers: { sample_provided: false, finish: "other" },
    errors: [
      { key: "finish_details", code: "required" },
      { key: "sample_reference", code: "required" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(field(context, copy.details)).toHaveAccessibleDescription(storyText(context, copy.required));
    await expect(context.canvas.getAllByRole("link")).toHaveLength(1);
    await expect(field(context, copy.reference)).toBeNull();
  },
};

/** Read only: layout fields show, hidden fields and sections don't. */
export const ReadOnly: Story = {
  args: { mode: "read", answers: { sample_provided: true, sample_reference: "S-1", lab_name: "SGS Jeddah", finish: "galvanised" } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("heading", { level: 4, name: storyText(context, copy.heading) })).toBeVisible();
    await expect(canvas.getByText("S-1")).toBeVisible();
    await expect(region(context, copy.labSection)).toBeVisible();
    await expect(canvas.queryAllByRole("textbox")).toEqual([]);
  },
};
