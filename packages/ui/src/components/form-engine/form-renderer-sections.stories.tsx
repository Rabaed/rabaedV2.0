import { formSchema } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// Who fills which Form Section (RP-301; form-engine.md §4). A section that isn't
// editable now is read-only; one filled in by another Participant, with no
// answers yet, is marked with who fills it. Story data only: real Forms are
// published by the database.
const schema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }],
    },
    {
      key: "verification",
      title: { en: "Consultant verification", ar: "تحقق الاستشاري" },
      editable_at: ["consultant_review"],
      fields: [
        { key: "sample_checked", type: "yes_no", label: { en: "Sample checked", ar: "تم فحص العينة" } },
        { key: "verification_note", type: "textarea", label: { en: "Verification note", ar: "ملاحظة التحقق" } },
      ],
    },
  ],
});

const consultant = { en: "Consultant", ar: "الاستشاري" };
const copy = {
  model: { en: "Model", ar: "الطراز" },
  material: { en: "Material", ar: "المادة" },
  verification: { en: "Consultant verification", ar: "تحقق الاستشاري" },
  filledBy: { en: "Filled in by the Consultant", ar: "يعبّئه الاستشاري" },
  yes: { en: "Yes", ar: "نعم" },
};

const meta = {
  title: "Form engine/FormRenderer/Form Sections",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", editableSections: ["material"], filledBy: { verification: consultant } },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const region = (context: PlayContext, label: { en: string; ar: string }) =>
  context.canvas.getByRole("region", { name: storyText(context, label) });

/** The raiser at the Draft: its own section to fill, the Consultant's empty, read-only and marked with who fills it. */
export const FilledByAnotherParticipant: Story = {
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(within(region(context, copy.material)).getByRole("textbox", { name: storyText(context, copy.model) })).toBeVisible();
    const verification = within(region(context, copy.verification));
    await expect(verification.getByText(storyText(context, copy.filledBy))).toBeVisible();
    await expect(verification.queryAllByRole("textbox")).toEqual([]);
    await expect(verification.queryAllByRole("radio")).toEqual([]);
  },
};

/** Once the Consultant has answered, its answers read like any other, without the mark. */
export const FilledIn: Story = {
  args: { answers: { model: "FD-90", sample_checked: true, verification_note: "Matches the sample." } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const verification = within(region(context, copy.verification));
    await expect(verification.getByText(storyText(context, copy.yes))).toBeVisible();
    await expect(verification.getByText("Matches the sample.")).toBeVisible();
    await expect(verification.queryByText(storyText(context, copy.filledBy))).toBeNull();
    await expect(verification.queryAllByRole("radio")).toEqual([]);
  },
};
