import { formSchema } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// The calculated field (RP-283, spec RP-278): a read-only number worked out
// from other fields, updated live as they change. Story data only: real Forms
// are published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "quantities",
      title: { en: "Quantities", ar: "الكميات" },
      fields: [
        { key: "length", type: "number", unit: "m", min: 0, decimals: 2, label: { en: "Length", ar: "الطول" } },
        { key: "width", type: "number", unit: "m", min: 0, decimals: 2, label: { en: "Width", ar: "العرض" } },
        {
          key: "area",
          type: "calculated",
          formula: "length × width",
          unit: "m²",
          decimals: 2,
          required: true,
          label: { en: "Area", ar: "المساحة" },
        },
        {
          key: "items",
          type: "table",
          label: { en: "Items", ar: "البنود" },
          columns: [
            { key: "fixture", type: "text", label: { en: "Fixture type", ar: "نوع التجهيز" } },
            { key: "quantity", type: "number", min: 0, decimals: 0, label: { en: "Quantity", ar: "الكمية" } },
          ],
        },
        {
          key: "per_m2",
          type: "calculated",
          formula: "sum(items.quantity) ÷ area",
          decimals: 2,
          label: { en: "Fixtures per m²", ar: "التجهيزات لكل م²" },
          help: { en: "Total quantity divided by the area.", ar: "إجمالي الكمية مقسومًا على المساحة." },
        },
      ],
    },
  ],
});

const copy = {
  length: { en: "Length", ar: "الطول" },
  width: { en: "Width", ar: "العرض" },
  area: { en: "Area", ar: "المساحة" },
  perM2: { en: "Fixtures per m²", ar: "التجهيزات لكل م²" },
  quantity: { en: "Quantity", ar: "الكمية" },
  addRow: { en: "Add row", ar: "إضافة صف" },
  empty: { en: "Not worked out yet", ar: "لم يُحسب بعد" },
  emptyRequired: { en: "Fill in the fields this is worked out from.", ar: "أكمل الحقول التي يُحسب منها." },
  unanswered: { en: "Not answered", ar: "لم تتم الإجابة" },
};

const meta = {
  title: "Form engine/FormRenderer/Calculated",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", onChange: fn() },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** A calculated field's result: a live region named by its label. */
const result = (context: PlayContext, name: Record<"en" | "ar", string>) =>
  context.canvas.getByRole("status", { name: storyText(context, name) });

/** Filling it in: each result follows its inputs as they are typed, and is empty after a division by zero. */
export const Edit: Story = {
  // A value sent with the answers is never shown: the result is worked out here, as the server does.
  args: { answers: { area: 999 } },
  render: function Render(args, context) {
    const [values, setValues] = useState<Record<string, unknown>>(args.answers);
    return (
      <FormRenderer
        {...args}
        locale={storyLocale(context)}
        answers={values}
        onChange={(changes) => {
          args.onChange?.(changes);
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
    );
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(result(context, copy.area)).toHaveTextContent(storyText(context, copy.empty));
    // Read-only: nothing to type into.
    await expect(canvas.queryByRole("textbox", { name: storyText(context, copy.area) })).toBeNull();

    fireEvent.change(canvas.getByLabelText(storyText(context, copy.length), { exact: false }), { target: { value: "4" } });
    await expect(result(context, copy.area)).toHaveTextContent(storyText(context, copy.empty));
    fireEvent.change(canvas.getByLabelText(storyText(context, copy.width), { exact: false }), { target: { value: "2.5" } });
    await expect(result(context, copy.area)).toHaveTextContent("10.00 m²");
    // The filler's answers are their own; the result is never sent as one of them.
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ width: 2.5 });

    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.addRow) }));
    fireEvent.change(canvas.getByLabelText(storyText(context, copy.quantity), { exact: false }), { target: { value: "25" } });
    await expect(result(context, copy.perM2)).toHaveTextContent(/(?<![\d,.])2\.50$/);

    // A division by zero leaves it empty rather than showing a wrong number.
    fireEvent.change(canvas.getByLabelText(storyText(context, copy.width), { exact: false }), { target: { value: "0" } });
    await expect(result(context, copy.area)).toHaveTextContent("0.00 m²");
    await expect(result(context, copy.perM2)).toHaveTextContent(storyText(context, copy.empty));
  },
};

/** Required and empty when leaving Draft: the message says to fill in its inputs, since it can't be typed. */
export const RequiredEmpty: Story = {
  args: { answers: { length: 4 }, errors: [{ key: "area", code: "required" }] },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(result(context, copy.area)).toHaveAccessibleDescription(storyText(context, copy.emptyRequired));
    await expect(within(context.canvas.getByRole("alert")).getByRole("link", { name: storyText(context, copy.area) })).toBeVisible();
  },
};

/** Read only: the stored results, to the field's decimals, with the unit. */
export const ReadOnly: Story = {
  args: {
    mode: "read",
    answers: { length: 4, width: 2.5, area: 10, items: [{ fixture: "Downlight", quantity: 25 }], per_m2: 2.5 },
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryByRole("status")).toBeNull();
    await expect(canvas.getByText(storyText(context, copy.area)).nextElementSibling).toHaveTextContent("10.00 m²");
    await expect(canvas.getByText(storyText(context, copy.perM2)).nextElementSibling).toHaveTextContent(/(?<![\d,.])2\.50$/);
  },
};

/** Read only, with an empty result: "Not answered", like any other field. */
export const ReadOnlyEmpty: Story = {
  args: { mode: "read", answers: { length: 4 } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.area)).nextElementSibling).toHaveTextContent(
      storyText(context, copy.unanswered),
    );
  },
};

/** On a phone: the results sit under their labels; nothing scrolls sideways. */
export const PhoneEdit: Story = {
  parameters: phone,
  args: { answers: { length: 4, width: 2.5, items: [{ fixture: "Downlight", quantity: 25 }] } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(result(context, copy.area)).toHaveTextContent("10.00 m²");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};
