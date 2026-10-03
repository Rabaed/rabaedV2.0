import { formSchema, validateAnswers, type FieldError } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import type { BuiltInChoices } from "./built-in-fields.tsx";
import { FormRenderer } from "./form-renderer.tsx";

// A Form like the MAR Form Version 1, with the Built-in Fields (Trade, Location,
// Scopes) placed mid-Form. Story data only: the real one is published by the database.
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
      key: "classification",
      title: { en: "Classification", ar: "التصنيف" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
      ],
    },
    {
      key: "details",
      title: { en: "Description", ar: "الوصف" },
      fields: [{ key: "description", type: "textarea", required: true, label: { en: "Description", ar: "الوصف" } }],
    },
  ],
});

const id = {
  electrical: "0190a1b2-0000-7000-8000-000000000001",
  mechanical: "0190a1b2-0000-7000-8000-000000000002",
  tower1: "0190a1b2-0000-7000-8000-000000000010",
  floor1: "0190a1b2-0000-7000-8000-000000000011",
  lighting: "0190a1b2-0000-7000-8000-000000000101",
  indoor: "0190a1b2-0000-7000-8000-000000000102",
  power: "0190a1b2-0000-7000-8000-000000000103",
  hvac: "0190a1b2-0000-7000-8000-000000000201",
};

const copy = {
  manufacturer: { en: "Manufacturer", ar: "المصنّع" },
  model: { en: "Model", ar: "الطراز" },
  description: { en: "Description", ar: "الوصف" },
  trade: { en: "Trade", ar: "التخصص" },
  location: { en: "Location", ar: "الموقع" },
  scopes: { en: "Scopes", ar: "النطاقات" },
  electrical: { en: "Electrical (EL)", ar: "الكهرباء (EL)" },
  mechanical: { en: "Mechanical (ME)", ar: "الميكانيكا (ME)" },
  tower1: { en: "Tower 1 (T1)", ar: "البرج 1 (T1)" },
  floor1: { en: "— Floor 1 (F1)", ar: "— الطابق 1 (F1)" },
  lighting: { en: "Lighting", ar: "الإنارة" },
  indoor: { en: "Indoor", ar: "داخلية" },
  power: { en: "Power", ar: "الطاقة" },
  hvac: { en: "HVAC", ar: "التكييف" },
  choose: { en: "Choose…", ar: "اختر…" },
  chooseTradeFirst: { en: "Choose a Trade first.", ar: "اختر التخصص أولًا." },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  tooLong: { en: "Use at most 20 characters.", ar: "استخدم 20 حرفًا على الأكثر." },
  unknownOption: { en: "Choose from the list offered.", ar: "اختر من القائمة المعروضة." },
  unanswered: { en: "Not answered", ar: "لم تتم الإجابة" },
  summary: { en: "3 fields need your attention:", ar: "3 حقول تحتاج إلى مراجعتك:" },
};

type StoryContext = { globals: Record<string, unknown> };

/** What the page offers: the Trades and Locations the filler covers, the active Scopes, in the viewer's language. */
const choices = (context: StoryContext): BuiltInChoices => {
  const text = (key: keyof typeof copy) => storyText(context, copy[key]);
  return {
    trades: [
      { id: id.electrical, label: text("electrical") },
      { id: id.mechanical, label: text("mechanical") },
    ],
    locations: [
      { id: id.tower1, label: text("tower1") },
      { id: id.floor1, label: text("floor1") },
    ],
    scopes: [
      { id: id.lighting, tradeId: id.electrical, parentId: null, label: text("lighting") },
      { id: id.indoor, tradeId: id.electrical, parentId: id.lighting, label: text("indoor") },
      { id: id.power, tradeId: id.electrical, parentId: null, label: text("power") },
      { id: id.hvac, tradeId: id.mechanical, parentId: null, label: text("hvac") },
    ],
  };
};

// Answers stay as typed, in whichever language the filler used.
const answers = {
  manufacturer: "ACME Cables",
  trade: id.electrical,
  location: id.floor1,
  scopes: [id.lighting, id.indoor],
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
type Text = { en: string; ar: string };

const textbox = (context: PlayContext, label: Text) => context.canvas.getByRole("textbox", { name: storyText(context, label) });
const combobox = (context: PlayContext, label: Text) => context.canvas.getByRole("combobox", { name: storyText(context, label) });
const checkbox = (context: PlayContext, label: Text) => context.canvas.getByRole("checkbox", { name: storyText(context, label) });
const noCheckbox = (context: PlayContext, label: Text) =>
  expect(context.canvas.queryByRole("checkbox", { name: storyText(context, label) })).toBeNull();

/** Opens a Select and chooses one of its options (the list renders in a portal, outside the story). */
async function choose(context: PlayContext, field: Text, option: Text) {
  await userEvent.click(combobox(context, field));
  await userEvent.click(await screen.findByRole("option", { name: storyText(context, option) }));
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

/** The Form being filled, with instant feedback from the validator, as the pages do. */
function Filling({ locale }: { locale: StoryContext }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  return (
    <>
      <FormRenderer
        schema={schema}
        mode="edit"
        locale={storyLocale(locale)}
        choices={choices(locale)}
        answers={values}
        errors={errors}
        onChange={(changes) => {
          const next = { ...values, ...changes };
          setValues(next);
          const checked = validateAnswers(schema, next, "draft");
          // The page asks for the Trade when it is saved, not before it is chosen.
          setErrors(checked.ok ? [] : checked.errors.filter((e) => e.key !== "trade"));
        }}
      />
      {/* The answers as they would be saved, for the play function to check. */}
      <output data-testid="answers" hidden>
        {JSON.stringify(values)}
      </output>
    </>
  );
}

const saved = (context: PlayContext) =>
  JSON.parse(context.canvasElement.querySelector("[data-testid=answers]")!.textContent!) as Record<string, unknown>;

/** Filling it: sections as headed regions, each field a labelled control; the validator gives instant feedback. */
export const Edit: Story = {
  render: (_args, context) => <Filling locale={context} />,
  play: async (context) => {
    await expect(context.canvas.getAllByRole("region")).toHaveLength(3);
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

/**
 * The Built-in Fields, mid-Form: Trade and Location always required; Scopes
 * list only the chosen Trade's, a Scope's Sub-scopes appear once it is chosen,
 * and a new Trade clears the Scopes that no longer fit.
 */
export const BuiltInFields: Story = {
  render: (_args, context) => <Filling locale={context} />,
  play: async (context) => {
    await expect(combobox(context, copy.trade)).toHaveAttribute("aria-required", "true");
    await expect(combobox(context, copy.location)).toHaveAttribute("aria-required", "true");
    await expect(combobox(context, copy.trade)).toHaveTextContent(storyText(context, copy.choose));
    await expect(context.canvas.getByText(storyText(context, copy.chooseTradeFirst))).toBeVisible();

    await choose(context, copy.trade, copy.electrical);
    await expect(context.canvas.getByRole("group", { name: storyText(context, copy.scopes) })).toBeVisible();
    noCheckbox(context, copy.hvac);
    // A Sub-scope appears under its Scope once the Scope is chosen.
    noCheckbox(context, copy.indoor);
    await userEvent.click(checkbox(context, copy.lighting));
    await userEvent.click(checkbox(context, copy.indoor));
    await userEvent.click(checkbox(context, copy.power));
    await expect(saved(context).scopes).toEqual([id.lighting, id.indoor, id.power]);
    // Unchoosing a Scope unchooses its Sub-scopes.
    await userEvent.click(checkbox(context, copy.lighting));
    noCheckbox(context, copy.indoor);
    await expect(saved(context).scopes).toEqual([id.power]);

    await choose(context, copy.location, copy.floor1);
    await expect(saved(context).location).toBe(id.floor1);

    // Another Trade: only its Scopes, and the old ones are cleared.
    await choose(context, copy.trade, copy.mechanical);
    noCheckbox(context, copy.power);
    await expect(checkbox(context, copy.hvac)).not.toBeChecked();
    await expect(saved(context)).toMatchObject({ trade: id.mechanical, scopes: [] });
  },
};

/** Refused: each field shows its error, and a summary above the Form links to each one. */
export const WithErrors: Story = {
  args: {
    answers: { model: "CT-300-GALVANISED-WIDE", trade: id.electrical },
    errors: [
      { key: "manufacturer", code: "required" },
      { key: "model", code: "too_long" },
      { key: "scopes", code: "unknown_option" },
      // Not a field of this Form: neither shown nor counted.
      { key: "colour", code: "unknown_field" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} choices={choices(context)} />,
  play: async (context) => {
    const manufacturer = textbox(context, copy.manufacturer);
    await expect(manufacturer).toBeInvalid();
    await expect(manufacturer).toHaveAccessibleDescription(storyText(context, copy.required));
    await expect(textbox(context, copy.model)).toHaveAccessibleDescription(storyText(context, copy.tooLong));
    await expect(context.canvas.getByRole("group", { name: storyText(context, copy.scopes) })).toHaveAccessibleDescription(
      storyText(context, copy.unknownOption),
    );
    // Empty and required, but not refused: only the errors given mark a field.
    await expect(textbox(context, copy.description)).not.toHaveAttribute("aria-invalid");
    await expect(combobox(context, copy.location)).not.toHaveAttribute("aria-invalid");
    const summary = context.canvas.getByRole("alert");
    await expect(summary).toHaveTextContent(storyText(context, copy.summary));
    const link = context.canvas.getByRole("link", { name: storyText(context, copy.manufacturer) });
    await expect(link).toHaveAttribute("href", `#${manufacturer.id}`);
  },
};

/** Read only: labels and answers, line breaks kept, chosen values by name; an empty field says so. No controls. */
export const ReadOnly: Story = {
  args: { mode: "read", answers },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} choices={choices(context)} />,
  play: async (context) => {
    await expect(context.canvas.queryAllByRole("textbox")).toEqual([]);
    await expect(context.canvas.queryAllByRole("combobox")).toEqual([]);
    await expect(context.canvas.queryAllByRole("checkbox")).toEqual([]);
    await expect(context.canvas.getByText("ACME Cables")).toBeVisible();
    await expect(context.canvas.getByText(/Includes bends and supports/)).toBeVisible();
    for (const value of [copy.electrical, copy.floor1, copy.lighting, copy.indoor]) {
      await expect(context.canvas.getByText(storyText(context, value))).toBeVisible();
    }
    await expect(context.canvas.getAllByText(storyText(context, copy.unanswered))).toHaveLength(2);
  },
};
