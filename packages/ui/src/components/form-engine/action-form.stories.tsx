import { formSchema, validateAnswers, type FieldError } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { actionFormLabels } from "../../storybook/form-engine.ts";
import { ActionForm, type ActionFormPage } from "./action-form.tsx";

// A Transition's pop-up (RP-300; form-engine.md §4 part 3): its Action Form, a
// Form schema drawn by the Form engine, then the Internal Note, which every
// pop-up has and which only the writer's Company sees (V5). Story data only:
// the MAR Workflow's schemas are published by the database.
const returnForm = formSchema.parse({
  sections: [
    {
      key: "return",
      title: { en: "Return", ar: "إعادة" },
      fields: [
        {
          key: "reason",
          type: "textarea",
          required: true,
          maxLength: 2000,
          label: { en: "Reason", ar: "السبب" },
          help: { en: "Only your Company sees this.", ar: "لا يراه إلا شركتك." },
        },
      ],
    },
  ],
});

/** A code's Remarks, as the MAR Workflow's Screens hold them: required with Code C, optional with A. */
const remarksForm = (required: boolean) =>
  formSchema.parse({
    sections: [
      {
        key: "code_remarks",
        title: { en: "Remarks", ar: "الملاحظات" },
        fields: [
          {
            key: "remarks",
            type: "textarea",
            required,
            maxLength: 4000,
            label: { en: "Remarks", ar: "الملاحظات" },
            help: { en: "Shared with everyone who sees this item.", ar: "يراها كل من يرى هذا العنصر." },
          },
        ],
      },
    ],
  });

const copy = {
  reason: { en: "Reason", ar: "السبب" },
  internalNote: { en: "Internal Note", ar: "ملاحظة داخلية" },
  internalNoteHelp: {
    en: "Optional. Only your Company sees it, even when the item goes to another Company. Anything for them goes in Chat or the Form.",
    ar: "اختيارية. لا يراها إلا شركتك، حتى عندما ينتقل العنصر إلى شركة أخرى. ما يخصهم يُكتب في المحادثة أو النموذج.",
  },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  sectionTitle: { en: "Return", ar: "إعادة" },
  remarks: { en: "Remarks", ar: "الملاحظات" },
  requiredWithC: { en: "Required with Code C", ar: "مطلوبة مع الرمز C" },
  optional: { en: "Optional", ar: "اختياري" },
  remarksHelp: { en: "TMC Constructions sees these Remarks with your name as signer.", ar: "ترى TMC Constructions هذه الملاحظات واسمك موقّعًا عليها." },
  remarksMissing: { en: "Write the Remarks for Code C.", ar: "اكتب الملاحظات للرمز C." },
  onlyYours: { en: "Only your Company sees it", ar: "لا يراها إلا شركتك" },
  placeholder: { en: "For Design Consultants LLC only…", ar: "لشركة Design Consultants LLC فقط…" },
};

// Story Companies, by name only.
const onThePage = (code: string): ActionFormPage => ({ code, remarksReader: "TMC Constructions", ownCompany: "Design Consultants LLC" });

type StoryContext = { globals: Record<string, unknown> };

/** The pop-up being filled, checked with the validator as the page does before sending. */
function Filling({
  context,
  schema,
  initialErrors = [],
  page,
}: {
  context: StoryContext;
  schema: typeof returnForm | null;
  initialErrors?: FieldError[];
  page?: ActionFormPage;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>(initialErrors);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const checked = schema ? validateAnswers(schema, answers, "complete") : { ok: true as const };
        setErrors(checked.ok ? [] : checked.errors);
      }}
      noValidate
    >
      <ActionForm
        schema={schema}
        answers={answers}
        errors={errors}
        internalNote={note}
        locale={storyLocale(context)}
        labels={actionFormLabels[storyLocale(context)]}
        onChange={(changes) => setAnswers({ ...answers, ...changes })}
        onInternalNoteChange={setNote}
        {...(page ? { page } : {})}
      />
      <button type="submit" className={page ? "mt-4 min-h-6 px-2" : undefined}>
        OK
      </button>
    </form>
  );
}

const meta = {
  title: "Form engine/ActionForm",
  component: ActionForm,
  args: { schema: returnForm, answers: {}, internalNote: "", locale: "en", labels: actionFormLabels.en, onChange: () => {}, onInternalNoteChange: () => {} },
  decorators: [(Story) => <div className="max-w-md">{Story()}</div>],
} satisfies Meta<typeof ActionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Return: its reason, from the schema and required, then the Internal Note under it. */
export const Return: Story = {
  render: (_args, context) => <Filling context={context} schema={returnForm} />,
  play: async (context) => {
    const reason = context.canvas.getByRole("textbox", { name: storyText(context, copy.reason) });
    const note = context.canvas.getByRole("textbox", { name: storyText(context, copy.internalNote) });
    await expect(reason).toBeRequired();
    await expect(reason).toHaveAttribute("maxlength", "2000");
    await expect(note).not.toBeRequired();
    await expect(context.canvas.getByText(storyText(context, copy.internalNoteHelp))).toBeVisible();
    // The Internal Note comes after the Action Form, whatever the language.
    await expect(reason.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The Transition titles the pop-up: the section's title only names its region.
    await expect(context.canvas.getByRole("region", { name: storyText(context, copy.sectionTitle) })).toBeVisible();
    await expect(context.canvas.getByRole("heading", { name: storyText(context, copy.sectionTitle) })).toHaveClass("sr-only");

    await userEvent.click(context.canvas.getByRole("button", { name: "OK" }));
    await expect(context.canvas.getAllByText(storyText(context, copy.required)).length).toBeGreaterThan(0);
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(reason, "Wrong tray size");
    await userEvent.type(note, "Checked with the site team");
    await userEvent.click(context.canvas.getByRole("button", { name: "OK" }));
    await expect(reason).not.toHaveAttribute("aria-invalid", "true");
    await expect(note).toHaveValue("Checked with the site team");
  },
};

/** A Transition whose Action Form asks nothing: only the Internal Note. */
export const InternalNoteOnly: Story = {
  render: (_args, context) => <Filling context={context} schema={null} />,
  play: async (context) => {
    await expect(context.canvas.getAllByRole("textbox")).toHaveLength(1);
    await expect(context.canvas.getByRole("textbox", { name: storyText(context, copy.internalNote) })).not.toBeRequired();
    await expect(context.canvas.queryByRole("region")).toBeNull();
  },
};

/** The API's refusal names the field to fix, as the validator would. */
export const Refused: Story = {
  render: (_args, context) => <Filling context={context} schema={returnForm} initialErrors={[{ key: "reason", code: "required" }]} />,
  play: async (context) => {
    await expect(context.canvas.getByRole("alert")).toBeVisible();
    await expect(context.canvas.getByRole("textbox", { name: storyText(context, copy.reason) })).toHaveAttribute("aria-invalid", "true");
  },
};

/**
 * The Work Item page's Code C pop-up (RP-1188, gap table rows 35–36): Remarks with the pill "Required
 * with Code C" and the help naming who reads them, the design's error when left empty; the Internal
 * Note tagged Optional, the amber line above the box and the placeholder naming the taker's own Company.
 */
export const CodeCOnThePage: Story = {
  render: (_args, context) => <Filling context={context} schema={remarksForm(true)} page={onThePage("C")} />,
  play: async (context) => {
    const remarks = context.canvas.getByRole("textbox", { name: storyText(context, copy.remarks) });
    const note = context.canvas.getByRole("textbox", { name: storyText(context, copy.internalNote) });
    await expect(remarks).toBeRequired();
    await expect(context.canvas.getByText(storyText(context, copy.requiredWithC))).toBeVisible();
    await expect(remarks).toHaveAccessibleDescription(storyText(context, copy.remarksHelp));
    await expect(context.canvas.queryByText(storyText(context, { en: "Shared with everyone who sees this item.", ar: "يراها كل من يرى هذا العنصر." }))).toBeNull();
    await expect(context.canvas.getByText(storyText(context, copy.optional))).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, copy.onlyYours))).toBeVisible();
    await expect(note).toHaveAttribute("placeholder", storyText(context, copy.placeholder));
    await expect(note).not.toBeRequired();
    // Remarks first, then the Internal Note.
    await expect(remarks.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(context.canvas.getByRole("button", { name: "OK" }));
    await expect(remarks).toHaveAttribute("aria-invalid", "true");
    await expect(context.canvas.getByText(storyText(context, copy.remarksMissing))).toBeVisible();
    await userEvent.type(remarks, "Add the wiring diagram");
    await userEvent.click(context.canvas.getByRole("button", { name: "OK" }));
    await expect(remarks).not.toHaveAttribute("aria-invalid", "true");
    await expect(context.canvas.queryByText(storyText(context, copy.remarksMissing))).toBeNull();
  },
};

/** Code A's pop-up on the page: its Remarks are optional, so they read "Optional" and nothing is refused. */
export const CodeAOnThePage: Story = {
  render: (_args, context) => <Filling context={context} schema={remarksForm(false)} page={onThePage("A")} />,
  play: async (context) => {
    const remarks = context.canvas.getByRole("textbox", { name: storyText(context, copy.remarks) });
    await expect(remarks).not.toBeRequired();
    await expect(context.canvas.getAllByText(storyText(context, copy.optional))).toHaveLength(2);
    await userEvent.click(context.canvas.getByRole("button", { name: "OK" }));
    await expect(remarks).not.toHaveAttribute("aria-invalid", "true");
  },
};
