import { formSchema, validateAnswers, type FieldError } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// A Form like the MAR Form Version 1. Story data only: the real one is published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: { en: "Material details", ar: "تفاصيل المادة" },
      fields: [
        { key: "manufacturer", type: "text", required: true, label: { en: "Manufacturer", ar: "المصنّع" } },
        { key: "model", type: "text", maxLength: 20, label: { en: "Model", ar: "الطراز" } },
        {
          key: "specification_section",
          type: "text",
          label: { en: "Specification section", ar: "بند المواصفات" },
          help: { en: "The section of the Project specification this material answers.", ar: "بند مواصفات المشروع الذي تستوفيه هذه المادة." },
        },
      ],
    },
    {
      key: "details",
      title: { en: "Description", ar: "الوصف" },
      fields: [{ key: "description", type: "textarea", required: true, label: { en: "Description", ar: "الوصف" } }],
    },
  ],
});

const copy = {
  manufacturer: { en: "Manufacturer", ar: "المصنّع" },
  model: { en: "Model", ar: "الطراز" },
  description: { en: "Description", ar: "الوصف" },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  tooLong: { en: "Use at most 20 characters.", ar: "استخدم 20 حرفًا على الأكثر." },
  unanswered: { en: "Not answered", ar: "لم تتم الإجابة" },
  summary: { en: "2 fields need your attention:", ar: "حقلان يحتاجان إلى مراجعتك:" },
};

// Answers stay as typed, in whichever language the filler used.
const answers = {
  manufacturer: "ACME Cables",
  model: "CT-300",
  description: "Hot-dip galvanised cable trays, 300 mm wide.\nIncludes bends and supports.",
};

const meta = {
  title: "Form engine/FormRenderer",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en" },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const textbox = (context: PlayContext, label: { en: string; ar: string }) =>
  context.canvas.getByRole("textbox", { name: storyText(context, label) });

/** Filling it: sections as headed regions, each field a labelled control; the validator gives instant feedback. */
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
        onChange={(key, value) => {
          const next = { ...values, [key]: value };
          setValues(next);
          const checked = validateAnswers(schema, next, "draft");
          setErrors(checked.ok ? [] : checked.errors);
        }}
      />
    );
  },
  play: async (context) => {
    await expect(context.canvas.getAllByRole("region")).toHaveLength(2);
    const manufacturer = textbox(context, copy.manufacturer);
    await expect(manufacturer).toBeRequired();
    await expect(textbox(context, copy.model)).not.toBeRequired();
    await userEvent.type(manufacturer, "ACME");
    await expect(manufacturer).toHaveValue("ACME");
    await userEvent.type(textbox(context, copy.description), "Line 1{Enter}Line 2");
    await expect(textbox(context, copy.description)).toHaveValue("Line 1\nLine 2");
    // The control caps its length, so typing never reaches a too-long error.
    await expect(textbox(context, copy.model)).toHaveAttribute("maxlength", "20");
  },
};

/** Refused: each field shows its error, and a summary above the Form links to each one. */
export const WithErrors: Story = {
  args: {
    answers: { model: "CT-300-GALVANISED-WIDE" },
    errors: [
      { key: "manufacturer", code: "required" },
      { key: "model", code: "too_long" },
      // Not a field of this Form: neither shown nor counted.
      { key: "colour", code: "unknown_field" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const manufacturer = textbox(context, copy.manufacturer);
    await expect(manufacturer).toBeInvalid();
    await expect(manufacturer).toHaveAccessibleDescription(storyText(context, copy.required));
    await expect(textbox(context, copy.model)).toHaveAccessibleDescription(storyText(context, copy.tooLong));
    // Empty and required, but not refused: only the errors given mark a field.
    await expect(textbox(context, copy.description)).not.toHaveAttribute("aria-invalid");
    const summary = context.canvas.getByRole("alert");
    await expect(summary).toHaveTextContent(storyText(context, copy.summary));
    const link = context.canvas.getByRole("link", { name: storyText(context, copy.manufacturer) });
    await expect(link).toHaveAttribute("href", `#${manufacturer.id}`);
  },
};

/** Read only: labels and answers, line breaks kept; an empty field says so. No controls. */
export const ReadOnly: Story = {
  args: { mode: "read", answers },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(context.canvas.queryAllByRole("textbox")).toEqual([]);
    await expect(context.canvas.getByText("ACME Cables")).toBeVisible();
    await expect(context.canvas.getByText(/Includes bends and supports/)).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, copy.unanswered))).toBeVisible();
  },
};
