import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { CheckboxGroup } from "./checkbox-group.tsx";
import { Field } from "./field.tsx";

const copy = {
  label: { en: "Certificates", ar: "الشهادات" },
  help: { en: "Choose every certificate the material has.", ar: "اختر كل الشهادات التي تحملها المادة." },
  error: { en: "Choose at least one.", ar: "اختر خيارًا واحدًا على الأقل." },
};

const options = (context: StoryContext) => [
  { value: "iso_9001", label: "ISO 9001" },
  { value: "saso", label: storyText(context, { en: "SASO", ar: "ساسو" }) },
  { value: "ce", label: storyText(context, { en: "CE marking", ar: "علامة CE" }) },
];

const meta = {
  title: "Forms/CheckboxGroup",
  component: Field,
  args: { label: "", children: null, group: true },
  render: function Render(args, context) {
    const [value, setValue] = useState<string[]>([]);
    return (
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <CheckboxGroup options={options(context)} value={value} onValueChange={setValue} />
      </Field>
    );
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const group = (context: PlayContext) => context.canvas.getByRole("group", { name: storyText(context, copy.label) });
const box = (context: PlayContext, index: number) => context.canvas.getAllByRole("checkbox")[index]!;

/** The group is named by its label and described by its help; each box by its option. Space and clicks toggle. */
export const Default: Story = {
  play: async (context) => {
    await expect(group(context)).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(box(context, 1)).toHaveAccessibleName(options(context)[1]!.label);
    // Only the group is described: the help isn't read again on every box.
    await expect(box(context, 1)).not.toHaveAttribute("aria-describedby");
    await expectTabFocusRing(box(context, 0));
    await userEvent.keyboard(" ");
    await expect(box(context, 0)).toBeChecked();
    await userEvent.click(context.canvas.getByText(options(context)[2]!.label));
    await expect(box(context, 2)).toBeChecked();
    await userEvent.click(box(context, 0));
    await expect(box(context, 0)).not.toBeChecked();
    await expect(box(context, 2)).toBeChecked();
  },
};

/** Refused: the group is described by its error, and every box is marked. */
export const Invalid: Story = {
  args: { required: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)} error={storyText(context, copy.error)}>
      <CheckboxGroup options={options(context)} />
    </Field>
  ),
  play: async (context) => {
    await expect(group(context)).toHaveAccessibleDescription(`${storyText(context, copy.help)} ${storyText(context, copy.error)}`);
    for (const b of context.canvas.getAllByRole("checkbox")) await expect(b).toBeInvalid();
  },
};

/** Read-only: shows what was chosen, stays focusable, and can't be changed. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)}>
      <CheckboxGroup options={options(context)} value={["saso"]} />
    </Field>
  ),
  play: async (context) => {
    await expect(box(context, 1)).toBeChecked();
    await expect(box(context, 1)).toHaveAttribute("aria-readonly", "true");
    await userEvent.click(box(context, 0));
    await expect(box(context, 0)).not.toBeChecked();
  },
};

/** On a phone, every box has a 44px touch target. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) => (
    <div className="p-4">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <CheckboxGroup options={options(context)} />
      </Field>
    </div>
  ),
  play: async (context) => {
    for (const b of context.canvas.getAllByRole("checkbox")) await expectTouchTarget(b);
  },
};
