import { checklistTemplateItems, formSchema, type ChecklistTemplateChoice, type Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { ChecklistTemplatePreview } from "./checklist-template-field.tsx";
import { FormRenderer } from "./form-renderer.tsx";

// The `checklist_template` field (RP-651, spec RP-649): the WIR's Checklist Template,
// picked from the Project's templates of the chosen Trade. The picked Version's items
// show read-only below the pick: what the Consultant answers on site. One picked and
// since edited or retired stays, marked, until another is picked; with none to offer it
// says so. Story data only: the API decides what is offered and copies the items.
const civil = "00000000-0000-4000-8000-0000000000c1";
const electrical = "00000000-0000-4000-8000-0000000000e1";
const location = "00000000-0000-4000-8000-000000000002";
const version = { pour: "00000000-0000-4000-8000-0000000000a1", oldPour: "00000000-0000-4000-8000-0000000000a2", trays: "00000000-0000-4000-8000-0000000000a3" };

const items = checklistTemplateItems.parse([
  { key: "formwork", text: { en: "Formwork level and tight", ar: "القوالب مستوية ومحكمة" } },
  {
    key: "rebar_cover",
    text: { en: "Rebar cover as per drawing", ar: "غطاء حديد التسليح حسب المخطط" },
    comment: "required_on_negative",
    photo: "required_on_negative",
  },
  { key: "cubes", text: { en: "Cube samples taken", ar: "أُخذت عينات المكعبات" }, answers: "yes_no_na", on_negative: "none" },
]);

const templates: ChecklistTemplateChoice[] = [
  { id: version.pour, tradeId: civil, offered: true, name: { en: "Concrete pour", ar: "صب الخرسانة" }, items },
  { id: version.oldPour, tradeId: civil, offered: false, name: { en: "Concrete pour", ar: "صب الخرسانة" }, items: items.slice(0, 2) },
  { id: version.trays, tradeId: electrical, offered: true, name: { en: "Cable trays", ar: "حوامل الكابلات" }, items },
];

const schema = formSchema.parse({
  sections: [
    {
      key: "checklist",
      title: { en: "Checklist", ar: "قائمة التحقق" },
      fields: [{ key: "checklist_template", type: "checklist_template", required: true, label: { en: "Checklist Template", ar: "قالب قائمة التحقق" } }],
    },
  ],
});

const copy = {
  label: { en: "Checklist Template", ar: "قالب قائمة التحقق" },
  none: { en: "No Checklist Template for this Trade yet", ar: "لا يوجد قالب قائمة تحقق لهذا التخصص بعد" },
  rebar: { en: "Rebar cover as per drawing", ar: "غطاء حديد التسليح حسب المخطط" },
};
const names: Record<Locale, { pour: string; kept: string; trays: string }> = {
  en: { pour: "Concrete pour", kept: "Concrete pour (as picked)", trays: "Cable trays" },
  ar: { pour: "صب الخرسانة", kept: "صب الخرسانة (كما اختير)", trays: "حوامل الكابلات" },
};

const meta = {
  title: "Form engine/FormRenderer/ChecklistTemplate",
  component: FormRenderer,
  args: { schema, answers: { trade: civil, location }, mode: "edit", locale: "en", labels: formRendererLabels.en, onChange: fn(), checklistTemplates: templates },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Picking it: only the active templates of the chosen Trade are offered; the picked one's items show below. */
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
    await expect(within(document.body).getAllByRole("option").map((o) => o.textContent)).toEqual([names[locale].pour]);
    await userEvent.click(within(document.body).getByRole("option", { name: names[locale].pour }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ checklist_template: version.pour });
    await expect(canvas.getByText(storyText(context, copy.rebar))).toBeVisible();
  },
};

/** A Version edited since it was picked stays the pick, marked, with the items it copied. */
export const Kept: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} labels={formRendererLabels[locale]} answers={{ trade: civil, location, checklist_template: version.oldPour }} />;
  },
  play: async (context) => {
    const locale = storyLocale(context);
    await expect(context.canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.label)) })).toHaveTextContent(names[locale].kept);
    await expect(context.canvas.getAllByRole("listitem")).toHaveLength(2);
  },
};

/** A Trade with no template: the field says so, and the WIR can't leave Draft until a Project Admin adds one. */
export const NoneForTrade: Story = {
  args: { answers: { trade: "00000000-0000-4000-8000-0000000000d9", location } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} labels={formRendererLabels[storyLocale(context)]} />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.none))).toBeVisible();
  },
};

const blockwork = "00000000-0000-4000-8000-0000000000a4";
/** The WIR request's templates: two of Civil, with their Versions, and one of another Trade, hidden. */
const cardTemplates: ChecklistTemplateChoice[] = [
  { ...templates[0]!, versionNo: 5 },
  { id: blockwork, tradeId: civil, offered: true, versionNo: 3, name: { en: "Blockwork before plastering", ar: "البلوك قبل اللياسة" }, items: items.slice(0, 2) },
  { ...templates[2]!, versionNo: 1 },
];
const cardCopy = {
  hidden: { en: "Templates for Civil · 1 for other Trades hidden", ar: "قوالب مدني · قالب واحد لتخصصات أخرى مخفي" },
  meta: { en: "v3 · 2 items", ar: "الإصدار 3 · بندان" },
  notice: { en: "On Fail, some items need a comment or a photo from the Consultant", ar: "عند مرفوض، تحتاج بعض البنود إلى تعليق أو صورة من الاستشاري" },
  hide: { en: "Hide items", ar: "إخفاء البنود" },
};

/**
 * The WIR request's look (RP-655): the sections in cards and the pick as radio cards, with the
 * Version and count, the Trade's line and when the pick locks. On a phone the picked one's preview
 * follows, which Hide items folds. Every other Form keeps the select.
 */
export const Cards: Story = {
  args: {
    checklistTemplates: cardTemplates,
    look: { sections: "cards", checklistTemplate: "cards" },
    choices: { trades: [{ id: civil, label: "Civil" }], locations: [], scopes: [] },
  },
  render: function Render(args, context) {
    const locale = storyLocale(context);
    const [values, setValues] = useState<Record<string, unknown>>({ trade: civil, location, checklist_template: version.pour });
    return (
      <FormRenderer
        {...args}
        choices={{ ...args.choices!, trades: [{ id: civil, label: locale === "ar" ? "مدني" : "Civil" }] }}
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
    await expect(canvas.getByText(storyText(context, cardCopy.hidden))).toBeVisible();
    // Only the Trade's two templates are cards; the other Trade's is hidden.
    await expect(canvas.getAllByRole("radio")).toHaveLength(2);
    await expect(canvas.getByText(storyText(context, cardCopy.meta))).toBeVisible();
    await userEvent.click(canvas.getByRole("radio", { name: new RegExp(storyText(context, { en: "Blockwork", ar: "البلوك" })) }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ checklist_template: blockwork });
    await expect(canvas.getByRole("radio", { name: new RegExp(storyText(context, { en: "Blockwork", ar: "البلوك" })) })).toBeChecked();
    // A wide screen (the story's) leaves the preview to the page, beside the Form.
    await expect(canvas.getByRole("button", { name: storyText(context, cardCopy.hide), hidden: true })).not.toBeVisible();
  },
};

/** The picked template at a glance (the WIR request's Template preview): name, Version and count, what a Fail asks for, the checks numbered. */
export const Preview: Story = {
  render: (_args, context) => {
    const locale = storyLocale(context);
    return <ChecklistTemplatePreview choice={cardTemplates[1]!} locale={locale} labels={formRendererLabels[locale].checklistTemplate} />;
  },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, cardCopy.meta))).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, cardCopy.notice))).toBeVisible();
    await expect(context.canvas.getAllByRole("listitem")).toHaveLength(2);
  },
};

/** Read only: the template's name and the items copied onto the item. */
export const ReadOnly: Story = {
  args: { mode: "read" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} labels={formRendererLabels[locale]} answers={{ trade: civil, location, checklist_template: version.pour }} />;
  },
  play: async (context) => {
    const locale = storyLocale(context);
    await expect(context.canvas.getByText(names[locale].pour)).toBeVisible();
    await expect(context.canvas.getAllByRole("listitem")).toHaveLength(3);
  },
};
