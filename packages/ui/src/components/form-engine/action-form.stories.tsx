import { formSchema, validateAnswers, type FieldError } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { ActionForm } from "./action-form.tsx";

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

const copy = {
  reason: { en: "Reason", ar: "السبب" },
  internalNote: { en: "Internal Note", ar: "ملاحظة داخلية" },
  internalNoteHelp: {
    en: "Optional. Only your Company sees it, even when the item goes to another Company. Anything for them goes in Chat or the Form.",
    ar: "اختيارية. لا يراها إلا شركتك، حتى عندما ينتقل العنصر إلى شركة أخرى. ما يخصهم يُكتب في المحادثة أو النموذج.",
  },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  sectionTitle: { en: "Return", ar: "إعادة" },
};

type StoryContext = { globals: Record<string, unknown> };

/** The pop-up being filled, checked with the validator as the page does before sending. */
function Filling({ context, schema, initialErrors = [] }: { context: StoryContext; schema: typeof returnForm | null; initialErrors?: FieldError[] }) {
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
        onChange={(changes) => setAnswers({ ...answers, ...changes })}
        onInternalNoteChange={setNote}
      />
      <button type="submit">OK</button>
    </form>
  );
}

const meta = {
  title: "Form engine/ActionForm",
  component: ActionForm,
  args: { schema: returnForm, answers: {}, internalNote: "", locale: "en", onChange: () => {}, onInternalNoteChange: () => {} },
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
