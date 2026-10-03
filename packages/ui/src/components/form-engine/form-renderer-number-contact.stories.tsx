import { formSchema, type FormValue } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, fn } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// Numbers, amounts and contact details (RP-264). Story data only: real Forms are published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "supply",
      title: { en: "Supply", ar: "التوريد" },
      fields: [
        {
          key: "quantity",
          type: "number",
          required: true,
          unit: "m²",
          min: 1,
          max: 5000,
          decimals: 2,
          label: { en: "Quantity", ar: "الكمية" },
        },
        {
          key: "weight",
          type: "number",
          unit: "طن",
          decimals: 1,
          label: { en: "Weight", ar: "الوزن" },
        },
        {
          key: "floors",
          type: "number",
          decimals: 0,
          label: { en: "Floors", ar: "عدد الطوابق" },
        },
        {
          key: "unit_price",
          type: "currency",
          required: true,
          min: 0,
          label: { en: "Unit price", ar: "سعر الوحدة" },
        },
      ],
    },
    {
      key: "contact",
      title: { en: "Supplier contact", ar: "جهة اتصال المورد" },
      fields: [
        {
          key: "contact_email",
          type: "email",
          required: true,
          label: { en: "Email", ar: "البريد الإلكتروني" },
        },
        {
          key: "contact_phone",
          type: "phone",
          label: { en: "Phone", ar: "الهاتف" },
          help: {
            en: "A KSA number, or an international one with its country code.",
            ar: "رقم سعودي، أو رقم دولي مع رمز الدولة.",
          },
        },
      ],
    },
  ],
});

const copy = {
  quantity: { en: "Quantity", ar: "الكمية" },
  weight: { en: "Weight", ar: "الوزن" },
  floors: { en: "Floors", ar: "عدد الطوابق" },
  unitPrice: { en: "Unit price", ar: "سعر الوحدة" },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  phone: { en: "Phone", ar: "الهاتف" },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  wholeNumber: { en: "Enter a whole number.", ar: "أدخل عددًا صحيحًا." },
  notANumber: { en: "Enter a number.", ar: "أدخل رقمًا." },
  invalidEmail: { en: "Enter a valid email address", ar: "أدخل بريدًا إلكترونيًا صالحًا" },
  invalidPhone: { en: "Enter a valid phone number", ar: "أدخل رقم هاتف صالحًا" },
  sar: { en: "SAR", ar: "ر.س" },
};

const answers: Record<string, FormValue> = {
  quantity: 1250.5,
  weight: 12.5,
  floors: 3,
  unit_price: 87.25,
  contact_email: "sales@gulf-steel.com.sa",
  contact_phone: "+966 50 123 4567",
};

const meta = {
  title: "Form engine/FormRenderer/Numbers and contacts",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", onChange: fn() },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const labelled = (context: PlayContext, label: { en: string; ar: string }) =>
  // Not exact: a required field's label ends with its (visual) asterisk.
  context.canvas.getByLabelText(storyText(context, label), { exact: false });

/** Filling it: numbers typed as text and answered as numbers; an email and a phone number as typed. Arabic-Indic digits become Latin ones. */
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
    const { args, canvas } = context;
    const quantity = labelled(context, copy.quantity);
    await expect(quantity).toBeRequired();
    await expect(quantity).toHaveAttribute("inputmode", "decimal");
    await expect(quantity).toHaveAttribute("dir", "ltr");
    await expect(canvas.getByText("m²")).toBeVisible();
    fireEvent.change(quantity, { target: { value: "1,250.5" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ quantity: 1250.5 });
    // On the way to a number, what was typed stays in the box.
    fireEvent.change(quantity, { target: { value: "12." } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ quantity: 12 });
    await expect(quantity).toHaveValue("12.");
    fireEvent.change(quantity, { target: { value: "" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ quantity: undefined });

    // An Arabic keyboard's digits and decimal separator, shown in Latin digits.
    const weight = labelled(context, copy.weight);
    fireEvent.change(weight, { target: { value: "١٢٫٥" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ weight: 12.5 });
    await expect(weight).toHaveValue("12.5");

    // Text that isn't a number is passed on, for the validator to refuse.
    fireEvent.change(labelled(context, copy.floors), { target: { value: "three" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ floors: "three" });

    await expect(canvas.getByText(storyText(context, copy.sar), { exact: false })).toBeVisible();
    fireEvent.change(labelled(context, copy.unitPrice), { target: { value: "87.25" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ unit_price: 87.25 });

    const email = labelled(context, copy.email);
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toBeRequired();
    fireEvent.change(email, { target: { value: "sales@gulf-steel.com.sa" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ contact_email: "sales@gulf-steel.com.sa" });

    const phone = labelled(context, copy.phone);
    await expect(phone).toHaveAttribute("type", "tel");
    await expect(phone).toHaveAttribute("dir", "ltr");
    fireEvent.change(phone, { target: { value: "٠٥٠ ١٢٣ ٤٥٦٧" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ contact_phone: "050 123 4567" });
    await expect(phone).toHaveValue("050 123 4567");
  },
};

/** Refused: a limit, decimals, not a number, an email and a phone number, each with its own message. */
export const WithErrors: Story = {
  args: {
    answers: { quantity: 9000, floors: 2.5, unit_price: "SAR 12", contact_email: "sales@", contact_phone: "12345" },
    errors: [
      { key: "quantity", code: "above_max" },
      { key: "floors", code: "too_many_decimals" },
      { key: "unit_price", code: "wrong_type" },
      { key: "contact_email", code: "invalid_format" },
      { key: "contact_phone", code: "invalid_format" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    const quantity = labelled(context, copy.quantity);
    await expect(quantity).toBeInvalid();
    await expect(quantity).toHaveValue("9000");
    // The limit reads as an answer would, with its unit.
    await expect(quantity).toHaveAccessibleDescription(/5,000\.00 m²/);
    await expect(labelled(context, copy.floors)).toHaveAccessibleDescription(storyText(context, copy.wholeNumber));
    await expect(labelled(context, copy.unitPrice)).toHaveAccessibleDescription(storyText(context, copy.notANumber));
    await expect(labelled(context, copy.email)).toHaveAccessibleDescription(new RegExp(`^${storyText(context, copy.invalidEmail)}`));
    // The help comes first, then the error.
    await expect(labelled(context, copy.phone)).toHaveAccessibleDescription(new RegExp(storyText(context, copy.invalidPhone)));
    await expect(canvas.getAllByRole("link")).toHaveLength(5);
  },
};

/** Read only: numbers grouped with Latin digits and their unit, amounts in SAR, contact details as typed. */
export const ReadOnly: Story = {
  args: { mode: "read", answers },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryAllByRole("textbox")).toEqual([]);
    const shown = canvas.getAllByRole("definition").map((dd) => dd.textContent ?? "");
    await expect(shown[0]).toMatch(/1,250\.50 m²/);
    await expect(shown[1]).toMatch(/12\.5 طن/);
    await expect(shown[2]).toBe("3");
    await expect(shown[3]).toContain("87.25");
    await expect(shown[3]).toContain(storyText(context, copy.sar));
    await expect(shown[4]).toBe("sales@gulf-steel.com.sa");
    await expect(shown[5]).toBe("+966 50 123 4567");
    // A number reads in the page's direction, so its unit follows it; contact details left to right.
    const [quantity, , , , email] = canvas.getAllByRole("definition").map((dd) => dd.querySelector("bdi")!);
    await expect(quantity).toHaveAttribute("dir", context.globals.locale === "ar" ? "rtl" : "ltr");
    await expect(email).toHaveAttribute("dir", "ltr");
  },
};
