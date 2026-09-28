import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { Field } from "./field.tsx";
import { Textarea } from "./textarea.tsx";

const copy = {
  label: { en: "Description", ar: "الوصف" },
  help: { en: "What the reviewer needs to know.", ar: "ما يحتاج المراجع إلى معرفته." },
  error: { en: "Enter a description.", ar: "أدخل وصفًا." },
  value: { en: "Shop drawings for the level 12 slab.", ar: "مخططات تنفيذية لبلاطة الطابق 12." },
};

const meta = {
  title: "Forms/Textarea",
  component: Field,
  args: { label: "", children: null },
  render: (args, context) => (
    <div className="max-w-sm">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <Textarea />
      </Field>
    </div>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const textbox = (context: PlayContext) => context.canvas.getByRole("textbox", { name: storyText(context, copy.label) });

/** Named by its label, described by its help text; Tab focuses it with a visible ring; Enter adds a line. */
export const Default: Story = {
  play: async (context) => {
    const input = textbox(context);
    await expect(input).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(input).not.toBeRequired();
    await expectTabFocusRing(input);
    await userEvent.keyboard("Line 1{Enter}Line 2");
    await expect(input).toHaveValue("Line 1\nLine 2");
  },
};

/** Required: the control is required; the asterisk is not part of its name. */
export const Required: Story = {
  args: { required: true },
  play: async (context) => {
    await expect(textbox(context)).toBeRequired();
  },
};

/** Invalid: marked invalid, with the error read after the help text. */
export const Invalid: Story = {
  args: { required: true },
  render: (args, context) => (
    <div className="max-w-sm">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)} error={storyText(context, copy.error)}>
        <Textarea />
      </Field>
    </div>
  ),
  play: async (context) => {
    const input = textbox(context);
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription(`${storyText(context, copy.help)} ${storyText(context, copy.error)}`);
  },
};

/** Disabled: announced as disabled and skipped by Tab. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async (context) => {
    const input = textbox(context);
    await expect(input).toBeDisabled();
    await userEvent.tab();
    await expect(input).not.toHaveFocus();
  },
};

/** Read-only: focusable and readable, but typing changes nothing. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  render: (args, context) => (
    <div className="max-w-sm">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <Textarea defaultValue={storyText(context, copy.value)} />
      </Field>
    </div>
  ),
  play: async (context) => {
    const input = textbox(context);
    await expect(input).toHaveAttribute("readonly");
    await expectTabFocusRing(input);
    await userEvent.keyboard("x");
    await expect(input).toHaveValue(storyText(context, copy.value));
  },
};

/** On a phone: comfortably above 44px for gloved hands. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expectTouchTarget(textbox(context));
  },
};
