import { formSchema, type Locale, type SupplierChoice } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { FormRenderer } from "./form-renderer.tsx";

// The `approved_supplier` field (RP-595, spec RP-598): the MAR's supplier, chosen
// from the Project's Approved Supplier List. Only approved suppliers of the chosen
// Trade are offered; one already chosen and since withdrawn stays, marked, until
// another is chosen; with none to offer it says so. Story data only: the API
// decides what is approved and refuses the rest.
const civil = "00000000-0000-4000-8000-0000000000c1";
const electrical = "00000000-0000-4000-8000-0000000000e1";
const location = "00000000-0000-4000-8000-000000000002";
const supplier = { cement: "00000000-0000-4000-8000-0000000000a1", old: "00000000-0000-4000-8000-0000000000a2", volt: "00000000-0000-4000-8000-0000000000a3" };

const suppliers: SupplierChoice[] = [
  { id: supplier.cement, tradeId: civil, status: "approved", name: { en: "Riyadh Cement", ar: "إسمنت الرياض" } },
  { id: supplier.old, tradeId: civil, status: "withdrawn", name: { en: "Old Cement Co", ar: "شركة الإسمنت القديمة" } },
  { id: supplier.volt, tradeId: electrical, status: "approved", name: { en: "Volt Supply", ar: "فولت للتوريد" } },
];

const schema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: { en: "Material details", ar: "تفاصيل المادة" },
      fields: [{ key: "supplier", type: "approved_supplier", required: true, label: { en: "Approved supplier", ar: "المورّد المعتمد" } }],
    },
    {
      key: "classification",
      title: { en: "Classification", ar: "التصنيف" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
      ],
    },
  ],
});

const copy = {
  label: { en: "Approved supplier", ar: "المورّد المعتمد" },
  none: { en: "No approved supplier for this Trade yet", ar: "لا يوجد مورّد معتمد لهذا التخصص بعد" },
};
const names: Record<Locale, { cement: string; old: string; volt: string }> = {
  en: { cement: "Riyadh Cement", old: "Old Cement Co", volt: "Volt Supply" },
  ar: { cement: "إسمنت الرياض", old: "شركة الإسمنت القديمة", volt: "فولت للتوريد" },
};

const meta = {
  title: "Form engine/FormRenderer/ApprovedSupplier",
  component: FormRenderer,
  args: { schema, answers: { trade: civil, location }, mode: "edit", locale: "en", labels: formRendererLabels.en, onChange: fn(), suppliers },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Filling it: only the approved suppliers of the chosen Trade are offered, never another Trade's or a withdrawn one. */
export const Edit: Story = {
  render: function Render(args, context) {
    const locale = storyLocale(context);
    const [values, setValues] = useState<Record<string, unknown>>({ trade: civil, location });
    return (
      <FormRenderer
        {...args}
        locale={locale}
        labels={formRendererLabels[locale]}
        answers={values}
        onChange={(changes) => {
          args.onChange?.(changes);
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
    );
  },
  play: async (context) => {
    const { canvas, args } = context;
    const locale = storyLocale(context);
    await userEvent.click(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.label)) }));
    const offered = within(document.body).getAllByRole("option");
    await expect(offered.map((o) => o.textContent)).toEqual(expect.arrayContaining([names[locale].cement]));
    await expect(within(document.body).queryByRole("option", { name: names[locale].old })).toBeNull();
    await expect(within(document.body).queryByRole("option", { name: names[locale].volt })).toBeNull();
    await userEvent.click(within(document.body).getByRole("option", { name: names[locale].cement }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ supplier: supplier.cement });
  },
};

/** A supplier withdrawn since it was chosen stays the choice, marked, and can be changed away from. */
export const Withdrawn: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} labels={formRendererLabels[locale]} answers={{ trade: civil, location, supplier: supplier.old }} />;
  },
  play: async (context) => {
    const locale = storyLocale(context);
    await expect(context.canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.label)) })).toHaveTextContent(names[locale].old);
  },
};

/** A Trade with no approved supplier: the field says so, and the MAR can't leave Draft until one is added. */
export const NoneForTrade: Story = {
  args: { answers: { trade: "00000000-0000-4000-8000-0000000000d9", location } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} labels={formRendererLabels[storyLocale(context)]} />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.none))).toBeVisible();
  },
};

/** Read only: the supplier's name, never an id. */
export const ReadOnly: Story = {
  args: { mode: "read" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} labels={formRendererLabels[locale]} answers={{ trade: civil, location, supplier: supplier.old }} />;
  },
  play: async (context) => {
    const locale = storyLocale(context);
    await expect(context.canvas.getByText(names[locale].old)).toBeVisible();
  },
};
