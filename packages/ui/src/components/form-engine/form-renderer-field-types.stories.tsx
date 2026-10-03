import { formSchema, type FormValue } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, fn, screen, userEvent, waitFor } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// Dates, times and choices (RP-265). Story data only: real Forms are published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "delivery",
      title: { en: "Delivery and inspection", ar: "التوريد والفحص" },
      fields: [
        {
          key: "delivery_date",
          type: "date",
          required: true,
          label: { en: "Delivery date", ar: "تاريخ التوريد" },
        },
        {
          key: "inspected_at",
          type: "datetime",
          label: { en: "Inspected at", ar: "وقت الفحص" },
        },
        {
          key: "start_time",
          type: "time",
          label: { en: "Work starts at", ar: "يبدأ العمل الساعة" },
        },
      ],
    },
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [
        {
          key: "sample_provided",
          type: "yes_no",
          required: true,
          label: { en: "Sample provided", ar: "تم تقديم عينة" },
        },
        {
          key: "finish",
          type: "select",
          label: { en: "Finish", ar: "التشطيب" },
          options: [
            { value: "galvanised", label: { en: "Galvanised", ar: "مجلفن" } },
            {
              value: "powder_coated",
              label: { en: "Powder coated", ar: "مطلي بالبودرة" },
            },
          ],
        },
        {
          key: "certificates",
          type: "multi_select",
          required: true,
          label: { en: "Certificates", ar: "الشهادات" },
          help: {
            en: "Choose every certificate the material has.",
            ar: "اختر كل الشهادات التي تحملها المادة.",
          },
          options: [
            { value: "iso_9001", label: { en: "ISO 9001", ar: "ISO 9001" } },
            { value: "saso", label: { en: "SASO", ar: "ساسو" } },
            { value: "ce", label: { en: "CE marking", ar: "علامة CE" } },
          ],
        },
      ],
    },
  ],
});

const copy = {
  deliveryDate: { en: "Delivery date", ar: "تاريخ التوريد" },
  inspectedAt: { en: "Inspected at", ar: "وقت الفحص" },
  startTime: { en: "Work starts at", ar: "يبدأ العمل الساعة" },
  sample: { en: "Sample provided", ar: "تم تقديم عينة" },
  finish: { en: "Finish", ar: "التشطيب" },
  certificates: { en: "Certificates", ar: "الشهادات" },
  certificatesHelp: {
    en: "Choose every certificate the material has.",
    ar: "اختر كل الشهادات التي تحملها المادة.",
  },
  no: { en: "No", ar: "لا" },
  none: { en: "None", ar: "بدون" },
  powderCoated: { en: "Powder coated", ar: "مطلي بالبودرة" },
  saso: { en: "SASO", ar: "ساسو" },
  invalidDate: { en: "Enter a valid date.", ar: "أدخل تاريخًا صالحًا." },
  invalidDatetime: {
    en: "Enter a valid date and time.",
    ar: "أدخل تاريخًا ووقتًا صالحين.",
  },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  unknownOption: { en: "Choose one of the options.", ar: "اختر أحد الخيارات." },
  // Shown in the viewer's language with Latin digits; the instant in Riyadh time (06:30 UTC is 09:30).
  date: { en: "Oct 3, 2026", ar: "2026" },
  datetime: { en: "Oct 3, 2026, 9:30 AM", ar: "9:30" },
  time: { en: "7:30 AM", ar: "7:30" },
  certificatesRead: { en: "SASO, ISO 9001", ar: "ساسو، ISO 9001" },
};

const answers: Record<string, FormValue> = {
  delivery_date: "2026-10-03",
  inspected_at: "2026-10-03T06:30:00.000Z",
  start_time: "07:30",
  sample_provided: false,
  finish: "powder_coated",
  certificates: ["saso", "iso_9001"],
};

const meta = {
  title: "Form engine/FormRenderer/Dates and choices",
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

/** Filling it: a date, a date and time in Project time, a time, Yes/No, one choice and several. */
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
    const date = labelled(context, copy.deliveryDate);
    await expect(date).toHaveAttribute("type", "date");
    await expect(date).toBeRequired();
    fireEvent.change(date, { target: { value: "2026-10-03" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ delivery_date: "2026-10-03" });

    // Picked in Riyadh time, stored in UTC.
    const datetime = labelled(context, copy.inspectedAt);
    await expect(datetime).toHaveAttribute("type", "datetime-local");
    fireEvent.change(datetime, { target: { value: "2026-10-03T09:30" } });
    await expect(args.onChange).toHaveBeenLastCalledWith({ inspected_at: "2026-10-03T06:30:00.000Z" });
    await expect(datetime).toHaveValue("2026-10-03T09:30");

    fireEvent.change(labelled(context, copy.startTime), {
      target: { value: "07:30" },
    });
    await expect(args.onChange).toHaveBeenLastCalledWith({ start_time: "07:30" });

    // No is an answer, not an empty field.
    const sample = canvas.getByRole("radiogroup", {
      name: storyText(context, copy.sample),
    });
    await expect(sample).toBeRequired();
    await userEvent.click(canvas.getByRole("radio", { name: storyText(context, copy.no) }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ sample_provided: false });

    // The open list renders in a portal at the end of <body>, outside the story.
    await userEvent.click(canvas.getByRole("combobox", { name: storyText(context, copy.finish) }));
    await expect(
      await screen.findByRole("option", {
        name: storyText(context, copy.none),
      }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("option", {
        name: storyText(context, copy.powderCoated),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(args.onChange).toHaveBeenLastCalledWith({ finish: "powder_coated" });

    const certificates = canvas.getByRole("group", {
      name: storyText(context, copy.certificates),
    });
    await expect(certificates).toHaveAccessibleDescription(storyText(context, copy.certificatesHelp));
    await userEvent.click(canvas.getByRole("checkbox", { name: storyText(context, copy.saso) }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "ISO 9001" }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ certificates: ["saso", "iso_9001"] });
  },
};

/** Refused: each type's message under its field, and the summary linking to each. */
export const WithErrors: Story = {
  args: {
    answers: { delivery_date: "03/10/2026", finish: "painted" },
    errors: [
      { key: "delivery_date", code: "invalid_format" },
      { key: "inspected_at", code: "invalid_format" },
      { key: "sample_provided", code: "required" },
      { key: "finish", code: "unknown_option" },
      { key: "certificates", code: "required" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(labelled(context, copy.deliveryDate)).toHaveAccessibleDescription(storyText(context, copy.invalidDate));
    await expect(labelled(context, copy.inspectedAt)).toHaveAccessibleDescription(storyText(context, copy.invalidDatetime));
    const sample = canvas.getByRole("radiogroup", {
      name: storyText(context, copy.sample),
    });
    await expect(sample).toHaveAccessibleDescription(storyText(context, copy.required));
    const finish = canvas.getByRole("combobox", {
      name: storyText(context, copy.finish),
    });
    await expect(finish).toBeInvalid();
    await expect(finish).toHaveAccessibleDescription(storyText(context, copy.unknownOption));
    const certificates = canvas.getByRole("group", {
      name: storyText(context, copy.certificates),
    });
    await expect(certificates).toHaveAccessibleDescription(new RegExp(`${storyText(context, copy.required)}$`));
    for (const box of canvas.getAllByRole("checkbox")) await expect(box).toBeInvalid();
    await expect(canvas.getAllByRole("link")).toHaveLength(5);
    const link = canvas.getByRole("link", {
      name: storyText(context, copy.certificates),
    });
    await expect(link).toHaveAttribute("href", `#${certificates.id}`);
  },
};

/** Read only: dates and times in the viewer's language with Latin digits; Yes/No and options by their labels. */
export const ReadOnly: Story = {
  args: { mode: "read", answers },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryAllByRole("textbox")).toEqual([]);
    await expect(canvas.queryAllByRole("radio")).toEqual([]);
    await expect(canvas.queryAllByRole("checkbox")).toEqual([]);
    const shown = canvas.getAllByRole("definition").map((dd) => dd.textContent ?? "");
    await expect(shown[0]).toContain(storyText(context, copy.date));
    await expect(shown[1]).toContain(storyText(context, copy.datetime));
    await expect(shown[2]).toContain(storyText(context, copy.time));
    await expect(shown[3]).toBe(storyText(context, copy.no));
    await expect(shown[4]).toBe(storyText(context, copy.powderCoated));
    await expect(shown[5]).toBe(storyText(context, copy.certificatesRead));
  },
};
