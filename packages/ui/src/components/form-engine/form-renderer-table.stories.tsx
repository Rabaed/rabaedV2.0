import { formSchema } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// The table field (RP-280, spec RP-278): rows of typed columns, row limits and
// totals. Story data only: real Forms are published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "supply",
      title: { en: "Supply", ar: "التوريد" },
      fields: [
        {
          key: "items",
          type: "table",
          required: true,
          minRows: 1,
          maxRows: 4,
          label: { en: "Items", ar: "البنود" },
          columns: [
            { key: "fixture", type: "text", required: true, label: { en: "Fixture type", ar: "نوع التجهيز" } },
            { key: "quantity", type: "number", required: true, min: 0, decimals: 0, unit: "pcs", total: true, label: { en: "Quantity", ar: "الكمية" } },
            { key: "unit_price", type: "currency", min: 0, total: true, label: { en: "Unit price", ar: "سعر الوحدة" } },
            { key: "delivery", type: "date", label: { en: "Delivery date", ar: "تاريخ التسليم" } },
            { key: "tested", type: "yes_no", label: { en: "Tested", ar: "تم الفحص" } },
            {
              key: "finish",
              type: "select",
              label: { en: "Finish", ar: "التشطيب" },
              options: [
                { value: "galvanised", label: { en: "Galvanised", ar: "مجلفن" } },
                { value: "powder_coated", label: { en: "Powder coated", ar: "مطلي بالبودرة" } },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const copy = {
  items: { en: "Items", ar: "البنود" },
  fixture: { en: "Fixture type", ar: "نوع التجهيز" },
  quantity: { en: "Quantity", ar: "الكمية" },
  addRow: { en: "Add row", ar: "إضافة صف" },
  removeRow1: { en: "Remove row 1", ar: "حذف الصف 1" },
  removeRow2: { en: "Remove row 2", ar: "حذف الصف 2" },
  row2: { en: "Row 2", ar: "الصف 2" },
  totalQuantity: { en: "Total Quantity", ar: "إجمالي الكمية" },
  noRows: { en: "No rows yet.", ar: "لا توجد صفوف بعد." },
  tooFew: { en: "Add at least 1 row.", ar: "أضف صفًا واحدًا على الأقل." },
  tooMany: { en: "Use at most 4 rows.", ar: "استخدم 4 صفوف على الأكثر." },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  notANumber: { en: "Enter a number.", ar: "أدخل رقمًا." },
  belowMin: { en: "Enter 0 pcs or more.", ar: "أدخل ⁧0 pcs⁩ أو أكثر." },
  limitReached: { en: "The most rows allowed is 4.", ar: "أقصى عدد للصفوف هو 4." },
};

const rows = [
  { fixture: "Downlight", quantity: 12, unit_price: 80.25, delivery: "2026-10-03", tested: true, finish: "galvanised" },
  { fixture: "Panel light", quantity: 30, unit_price: 120, tested: false },
  { fixture: "Emergency exit sign", quantity: 8, finish: "powder_coated" },
] satisfies Record<string, string | number | boolean>[];

const meta = {
  title: "Form engine/FormRenderer/Table",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", onChange: fn() },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const rowGroup = (context: PlayContext, row: number) =>
  context.canvas.getByRole("group", { name: storyText(context, { en: `Row ${row}`, ar: `الصف ${row}` }) });

/** Filling it: add and remove rows, each cell typed by its column, the total follows as numbers change. */
export const Edit: Story = {
  render: function Render(args, context) {
    const [values, setValues] = useState<Record<string, unknown>>({});
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
    await expect(canvas.getByRole("group", { name: new RegExp(storyText(context, copy.items)) })).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.noRows))).toBeVisible();

    const add = canvas.getByRole("button", { name: storyText(context, copy.addRow) });
    await userEvent.click(add);
    // The new row's first field takes focus.
    const first = within(rowGroup(context, 1));
    await expect(first.getByLabelText(storyText(context, copy.fixture), { exact: false })).toHaveFocus();
    await expect(first.getByLabelText(storyText(context, copy.fixture), { exact: false })).toBeRequired();

    fireEvent.change(first.getByLabelText(storyText(context, copy.fixture), { exact: false }), { target: { value: "Downlight" } });
    fireEvent.change(first.getByLabelText(storyText(context, copy.quantity), { exact: false }), { target: { value: "12" } });
    await userEvent.click(add);
    fireEvent.change(within(rowGroup(context, 2)).getByLabelText(storyText(context, copy.quantity), { exact: false }), {
      target: { value: "30" },
    });

    // Answered as a list of row objects keyed by column key; a cell left empty isn't in its row.
    await expect(context.args.onChange).toHaveBeenLastCalledWith({
      items: [{ fixture: "Downlight", quantity: 12 }, { quantity: 30 }],
    });
    // The total adds the rows up, with the column's unit.
    await expect(canvas.getByText(storyText(context, copy.totalQuantity))).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.totalQuantity)).nextElementSibling?.textContent).toBe("42 pcs");

    // Removing a row removes its cells; focus goes back to "Add row".
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.removeRow1) }));
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ items: [{ quantity: 30 }] });
    await expect(canvas.getByRole("button", { name: storyText(context, copy.addRow) })).toHaveFocus();
    await expect(canvas.getByText(storyText(context, copy.totalQuantity)).nextElementSibling?.textContent).toBe("30 pcs");

    // The last row removed leaves no answer.
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.removeRow1) }));
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ items: undefined });
    await expect(canvas.getByText(storyText(context, copy.noRows))).toBeVisible();
  },
};

/** The most rows the table allows: "Add row" stops, with the reason beside it. */
export const AtMaximum: Story = {
  args: { answers: { items: [rows[0], rows[1], rows[2], { fixture: "Pole" }] } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("button", { name: storyText(context, copy.addRow) })).toBeDisabled();
    await expect(canvas.getByText(storyText(context, copy.limitReached))).toBeVisible();
  },
};

/** Refused: a cell of the wrong type or outside its limits shows its message under that cell; the table's own message under the table. */
export const WithErrors: Story = {
  args: {
    answers: {
      items: [
        { fixture: "Downlight", quantity: "12" },
        { fixture: "Panel light", quantity: -2 },
        { quantity: 4 },
      ],
    },
    errors: [
      { key: "items", code: "wrong_type", row: 0, column: "quantity" },
      { key: "items", code: "below_min", row: 1, column: "quantity" },
      { key: "items", code: "required", row: 2, column: "fixture" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    const quantity = (row: number) => within(rowGroup(context, row)).getByLabelText(storyText(context, copy.quantity), { exact: false });
    await expect(quantity(1)).toBeInvalid();
    await expect(quantity(1)).toHaveValue("12");
    await expect(quantity(1)).toHaveAccessibleDescription(storyText(context, copy.notANumber));
    await expect(quantity(2)).toHaveAccessibleDescription(storyText(context, copy.belowMin));
    await expect(quantity(3)).not.toBeInvalid();
    await expect(
      within(rowGroup(context, 3)).getByLabelText(storyText(context, copy.fixture), { exact: false }),
    ).toHaveAccessibleDescription(storyText(context, copy.required));
    // One link for the table, however many cells are wrong.
    await expect(canvas.getAllByRole("link")).toHaveLength(1);
  },
};

/** Too few rows: the table's own error, with nothing to point at but the table. */
export const TooFewRows: Story = {
  args: { errors: [{ key: "items", code: "required" }] },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("group", { name: new RegExp(storyText(context, copy.items)) })).toHaveAccessibleDescription(
      storyText(context, copy.required),
    );
  },
};

/** Too many rows, in a table that is already full. */
export const TooManyRows: Story = {
  args: { answers: { items: [...rows, ...rows] }, errors: [{ key: "items", code: "too_many_rows" }] },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.tooMany))).toBeVisible();
  },
};

/** Read only: a real table of the rows as submitted, numbers and dates in the viewer's language, with the totals under it. */
export const ReadOnly: Story = {
  args: { mode: "read", answers: { items: rows } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryAllByRole("textbox")).toEqual([]);
    await expect(canvas.queryAllByRole("button")).toEqual([]);
    const table = canvas.getByRole("table", { name: storyText(context, copy.items) });
    await expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    await expect(within(table).getAllByRole("row")).toHaveLength(4);
    await expect(within(table).getByRole("cell", { name: "Downlight" })).toBeVisible();
    await expect(within(table).getByRole("cell", { name: /^12 pcs$/ })).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.totalQuantity)).nextElementSibling?.textContent).toBe("50 pcs");
  },
};

/** Nothing answered: "Not answered", like any other field. */
export const ReadOnlyEmpty: Story = {
  args: { mode: "read" },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(context.canvas.queryByRole("table")).toBeNull();
    await expect(context.canvas.getByText(storyText(context, { en: "Not answered", ar: "لم تتم الإجابة" }))).toBeVisible();
  },
};

/** On a phone: each row is a group of fields in one column, with touch-sized buttons; nothing scrolls sideways. */
export const PhoneEdit: Story = {
  parameters: phone,
  args: { answers: { items: rows.slice(0, 2) } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expectTouchTarget(canvas.getByRole("button", { name: storyText(context, copy.addRow) }));
    await expectTouchTarget(canvas.getByRole("button", { name: storyText(context, copy.removeRow2) }));
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};

/** On a phone, read only: the table scrolls inside its own region rather than widening the page. */
export const PhoneReadOnly: Story = {
  parameters: phone,
  args: { mode: "read", answers: { items: rows } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async () => {
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};

