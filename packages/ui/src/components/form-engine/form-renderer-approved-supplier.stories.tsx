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
// another is chosen; with none to offer it says so. Read mode opens the SAR that
// approved the supplier, for a reader who sees it (RP-1306). Story data only: the
// API decides what is approved, who reads its SAR, and refuses the rest.
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

// RP-1306: the SAR that approved a supplier, as the list gives it to a reader who sees that SAR.
const sar = "00000000-0000-4000-8000-0000000005a1";
const sarNumber = "TWR-SAR-CCM-0003";
const sarSubject: Record<Locale, string> = { en: "Riyadh Cement as cement supplier", ar: "اعتماد إسمنت الرياض مورّدًا للإسمنت" };
const links = { targets: {}, search: async () => ({ links: [], nextPage: null }), hrefFor: (choice: unknown) => (typeof choice === "string" ? `/work-items/${choice}` : null) };
const withApproval = (locale: Locale): SupplierChoice[] =>
  suppliers.map((s) => (s.id === supplier.cement ? { ...s, approval: { workItemId: sar, documentNumber: sarNumber, subject: sarSubject[locale] } } : { ...s, approval: null }));

/**
 * Read only, by a Member who sees the SAR that approved the supplier (RP-1306, V10): the name opens that SAR,
 * with its Document Number (left to right) and Subject.
 */
export const ReadWithApproval: Story = {
  args: { mode: "read" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <FormRenderer {...args} locale={locale} labels={formRendererLabels[locale]} suppliers={withApproval(locale)} links={links} answers={{ trade: civil, location, supplier: supplier.cement }} />
    );
  },
  play: async (context) => {
    const locale = storyLocale(context);
    const link = context.canvas.getByRole("link", { name: new RegExp(names[locale].cement) });
    await expect(link).toHaveAttribute("href", `/work-items/${sar}`);
    await expect(link).toHaveTextContent(sarSubject[locale]);
    await expect(within(link).getByText(sarNumber)).toHaveAttribute("dir", "ltr");
  },
};

/**
 * Read only, by another Company's Member, who can't see the SAR (RP-1306): the name alone, with no number and
 * no Subject, exactly as for a supplier a Project Admin added by hand.
 */
export const ReadWithoutApproval: Story = {
  args: { mode: "read" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} labels={formRendererLabels[locale]} links={links} answers={{ trade: civil, location, supplier: supplier.cement }} />;
  },
  play: async (context) => {
    const locale = storyLocale(context);
    await expect(context.canvas.getByText(names[locale].cement)).toBeVisible();
    await expect(context.canvas.queryByRole("link")).toBeNull();
    await expect(context.canvas.queryByText(sarNumber)).toBeNull();
  },
};
