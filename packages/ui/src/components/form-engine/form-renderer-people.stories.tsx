import { formSchema, type FormChoices, type NamedAnswers } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// Member and Participant fields (RP-266). Story data only: the API offers the
// choices (only those the filler can see, V15) and names the answers (V14).
const schema = formSchema.parse({
  sections: [
    {
      key: "responsibility",
      title: { en: "Responsibility", ar: "المسؤولية" },
      fields: [
        {
          key: "site_engineer",
          type: "member",
          required: true,
          label: { en: "Site engineer", ar: "مهندس الموقع" },
        },
        {
          key: "supplied_through",
          type: "participant",
          label: { en: "Supplied through", ar: "التوريد عن طريق" },
        },
      ],
    },
  ],
});

const ids = {
  ahmed: "0199a3b0-0000-7000-8000-000000000001",
  sara: "0199a3b0-0000-7000-8000-000000000002",
  hala: "0199a3b0-0000-7000-8000-000000000003",
  nasser: "0199a3b0-0000-7000-8000-000000000004",
  khalid: "0199a3b0-0000-7000-8000-000000000005",
  c1: "0199a3b0-0000-7000-8000-000000000011",
  host: "0199a3b0-0000-7000-8000-000000000012",
};

const copy = {
  siteEngineer: { en: "Site engineer", ar: "مهندس الموقع" },
  suppliedThrough: { en: "Supplied through", ar: "التوريد عن طريق" },
  ahmed: { en: "Ahmed Al-Harbi", ar: "أحمد الحربي" },
  sara: { en: "Sara Al-Qahtani", ar: "سارة القحطاني" },
  khalid: { en: "Khalid Al-Shehri", ar: "خالد الشهري" },
  leftProject: { en: "⁨Khalid Al-Shehri⁩ (no longer on the Project)", ar: "⁨خالد الشهري⁩ (لم يعد في المشروع)" },
  c1: { en: "C1 Contracting", ar: "سي ون للمقاولات" },
  host: { en: "Riyadh Development Co.", ar: "شركة الرياض للتطوير" },
  none: { en: "None", ar: "بدون" },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  unknownOption: { en: "Choose one of the options.", ar: "اختر أحد الخيارات." },
  anotherCompany: { en: "Another Company", ar: "شركة أخرى" },
};

const choices: FormChoices = {
  members: [
    { id: ids.ahmed, name: copy.ahmed },
    { id: ids.sara, name: copy.sara },
  ],
  participants: [
    { id: ids.c1, name: copy.c1 },
    { id: ids.host, name: copy.host },
  ],
};

const meta = {
  title: "Form engine/FormRenderer/Members and Participants",
  component: FormRenderer,
  args: { schema, answers: {}, people: choices, mode: "edit", locale: "en", onChange: fn() },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Filling it: only the Members and Participants the API offered; an optional one can be taken back. */
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
    // The open list renders in a portal at the end of <body>, outside the story.
    await userEvent.click(canvas.getByRole("combobox", { name: storyText(context, copy.siteEngineer) }));
    await expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      storyText(context, copy.ahmed),
      storyText(context, copy.sara),
    ]);
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.sara) }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(args.onChange).toHaveBeenLastCalledWith({ site_engineer: ids.sara });

    await userEvent.click(canvas.getByRole("combobox", { name: storyText(context, copy.suppliedThrough) }));
    await expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      storyText(context, copy.none),
      storyText(context, copy.c1),
      storyText(context, copy.host),
    ]);
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.host) }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(args.onChange).toHaveBeenLastCalledWith({ supplied_through: ids.host });
  },
};

/**
 * Members sort in the viewer's language: Hala comes first in English, Nasser
 * first in Arabic (ن before ه). Participants keep the API's order.
 */
export const MembersSortedByLanguage: Story = {
  args: {
    people: {
      members: [
        { id: ids.hala, name: { en: "Hala Al-Dosari", ar: "هالة الدوسري" } },
        { id: ids.nasser, name: { en: "Nasser Al-Otaibi", ar: "ناصر العتيبي" } },
      ],
      participants: choices.participants,
    },
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("combobox", { name: storyText(context, copy.siteEngineer) }));
    const listed = (await screen.findAllByRole("option")).map((o) => o.textContent);
    const hala = storyText(context, { en: "Hala Al-Dosari", ar: "هالة الدوسري" });
    const nasser = storyText(context, { en: "Nasser Al-Otaibi", ar: "ناصر العتيبي" });
    await expect(listed).toEqual(storyLocale(context) === "ar" ? [nasser, hala] : [hala, nasser]);
    // Close the list: the a11y check can't run with the story hidden behind it.
    await userEvent.click(screen.getByRole("option", { name: hala }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  },
};

/**
 * A saved Member who has since left the Project (RP-277): still the answer, so
 * the picker shows them by name, marked; once another is chosen, they're gone.
 */
export const SavedMemberLeftProject: Story = {
  args: {
    answers: { site_engineer: ids.khalid },
    named: { site_engineer: { companyName: copy.c1, memberName: copy.khalid } } satisfies NamedAnswers,
  },
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
    const { args, canvas } = context;
    const left = storyText(context, copy.leftProject);
    const engineer = canvas.getByRole("combobox", { name: storyText(context, copy.siteEngineer) });
    await expect(engineer).toHaveTextContent(left);

    await userEvent.click(engineer);
    await expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      left,
      storyText(context, copy.ahmed),
      storyText(context, copy.sara),
    ]);
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.sara) }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(args.onChange).toHaveBeenLastCalledWith({ site_engineer: ids.sara });

    // Changed: the Member who left can't be chosen again.
    await userEvent.click(engineer);
    await expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      storyText(context, copy.ahmed),
      storyText(context, copy.sara),
    ]);
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.sara) }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  },
};

/** Refused: required, and an id the filler wasn't offered (the server's answer for any id it can't take). */
export const WithErrors: Story = {
  args: {
    answers: { supplied_through: "0199a3b0-0000-7000-8000-00000000dead" },
    errors: [
      { key: "site_engineer", code: "required" },
      { key: "supplied_through", code: "unknown_option" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    const engineer = canvas.getByRole("combobox", { name: storyText(context, copy.siteEngineer) });
    await expect(engineer).toHaveAccessibleDescription(storyText(context, copy.required));
    const through = canvas.getByRole("combobox", { name: storyText(context, copy.suppliedThrough) });
    await expect(through).toBeInvalid();
    await expect(through).toHaveAccessibleDescription(storyText(context, copy.unknownOption));
  },
};

/** Read by the filler's own Company: its Member by name, the Participant by its Company's name. */
export const ReadOwnCompany: Story = {
  args: {
    mode: "read",
    answers: { site_engineer: ids.ahmed, supplied_through: ids.host },
    named: {
      site_engineer: { companyName: copy.c1, memberName: copy.ahmed },
      supplied_through: { companyName: copy.host, memberName: null },
    } satisfies NamedAnswers,
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const shown = context.canvas.getAllByRole("definition").map((dd) => dd.textContent ?? "");
    await expect(shown).toEqual([storyText(context, copy.ahmed), storyText(context, copy.host)]);
  },
};

/**
 * Read by another Company (V14): C1's Member as C1's name only, with no id in
 * the answers; a Company it may not see as "Another Company"; never an id.
 */
export const ReadAnotherCompany: Story = {
  args: {
    mode: "read",
    answers: { supplied_through: ids.host },
    named: {
      site_engineer: { companyName: copy.c1, memberName: null },
      supplied_through: { companyName: null, memberName: null },
    } satisfies NamedAnswers,
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const shown = context.canvas.getAllByRole("definition").map((dd) => dd.textContent ?? "");
    await expect(shown).toEqual([storyText(context, copy.c1), storyText(context, copy.anotherCompany)]);
    await expect(context.canvasElement.textContent).not.toContain(ids.host);
  },
};
