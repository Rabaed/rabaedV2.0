import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { Checkbox } from "./checkbox.tsx";
import { Field } from "./field.tsx";

const copy = {
  label: { en: "Notify the Consultant", ar: "إشعار الاستشاري" },
  help: { en: "They get an email when you submit.", ar: "يصلهم بريد إلكتروني عند الإرسال." },
  error: { en: "Confirm before you submit.", ar: "أكّد قبل الإرسال." },
};

const meta = {
  title: "Forms/Checkbox",
  component: Field,
  args: { label: "", children: null, layout: "inline" },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <Checkbox />
    </Field>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const checkbox = (context: PlayContext) => context.canvas.getByRole("checkbox", { name: storyText(context, copy.label) });

/** Named by its label and described by its help; Space toggles it, and so does clicking the label. */
export const Default: Story = {
  play: async (context) => {
    const box = checkbox(context);
    await expect(box).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(box).not.toBeChecked();
    await expectTabFocusRing(box);
    await userEvent.keyboard(" ");
    await expect(box).toBeChecked();
    await userEvent.click(context.canvas.getByText(storyText(context, copy.label)));
    await expect(box).not.toBeChecked();
  },
};

/** Checked and indeterminate, for the visual baseline. */
export const States: Story = {
  render: (args, context) => (
    <div className="flex flex-col gap-3">
      <Field {...args} label={storyText(context, copy.label)}>
        <Checkbox defaultChecked />
      </Field>
      <Field {...args} label={storyText(context, { en: "All trades", ar: "كل التخصصات" })}>
        <Checkbox defaultChecked="indeterminate" />
      </Field>
    </div>
  ),
  play: async (context) => {
    await expect(checkbox(context)).toBeChecked();
    await expect(context.canvas.getByRole("checkbox", { name: storyText(context, { en: "All trades", ar: "كل التخصصات" }) })).toBePartiallyChecked();
  },
};

export const Required: Story = {
  args: { required: true },
  play: async (context) => {
    await expect(checkbox(context)).toBeRequired();
  },
};

export const Invalid: Story = {
  args: { required: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)} error={storyText(context, copy.error)}>
      <Checkbox />
    </Field>
  ),
  play: async (context) => {
    const box = checkbox(context);
    await expect(box).toBeInvalid();
    await expect(box).toHaveAccessibleDescription(`${storyText(context, copy.help)} ${storyText(context, copy.error)}`);
  },
};

/** Disabled: skipped by Tab, and clicks change nothing. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async (context) => {
    const box = checkbox(context);
    await expect(box).toBeDisabled();
    await userEvent.tab();
    await expect(box).not.toHaveFocus();
    await userEvent.click(box, { pointerEventsCheck: 0 });
    await expect(box).not.toBeChecked();
  },
};

/** Read-only: focusable and announced read-only; Space and clicks change nothing. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <Checkbox defaultChecked />
    </Field>
  ),
  play: async (context) => {
    const box = checkbox(context);
    await expect(box).toHaveAttribute("aria-readonly", "true");
    await expectTabFocusRing(box);
    await userEvent.keyboard(" ");
    await userEvent.click(box);
    await expect(box).toBeChecked();
  },
};

/** On a phone: a 44px touch area around the box. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) => (
    <div className="p-4">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <Checkbox />
      </Field>
    </div>
  ),
  play: async (context) => {
    await expectTouchTarget(checkbox(context));
  },
};
