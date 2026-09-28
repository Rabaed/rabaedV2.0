import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone, press } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Field } from "./field.tsx";
import { SegmentedControl } from "./segmented-control.tsx";

const copy = {
  label: { en: "View", ar: "العرض" },
  help: { en: "Your choice is kept for this Module.", ar: "يُحفظ اختيارك لهذه الوحدة." },
  error: { en: "Choose a view.", ar: "اختر طريقة العرض." },
};

const options = (context: StoryContext) => [
  { value: "list", label: storyText(context, { en: "List", ar: "قائمة" }) },
  { value: "board", label: storyText(context, { en: "Board", ar: "لوحة" }) },
  { value: "plan", label: storyText(context, { en: "Plan", ar: "مخطط" }) },
];

const meta = {
  title: "Forms/SegmentedControl",
  component: Field,
  args: { label: "", children: null, group: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <SegmentedControl options={options(context)} defaultValue="list" />
    </Field>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const group = (context: PlayContext) => context.canvas.getByRole("radiogroup", { name: storyText(context, copy.label) });
const segment = (context: PlayContext, index: number) =>
  context.canvas.getByRole("radio", { name: options(context)[index]!.label });

/**
 * One segment per option, named by its text. The arrow key pointing along the
 * reading direction (→ in English, ← in Arabic) moves to the next segment.
 */
export const Default: Story = {
  play: async (context) => {
    await expect(group(context)).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(segment(context, 0)).toBeChecked();
    await expectTabFocusRing(segment(context, 0));
    const forward = storyLocale(context) === "ar" ? "ArrowLeft" : "ArrowRight";
    await press(forward);
    await expect(segment(context, 1)).toBeChecked();
    await expect(segment(context, 1)).toHaveFocus();
    await userEvent.click(segment(context, 2));
    await expect(segment(context, 2)).toBeChecked();
  },
};

export const Required: Story = {
  args: { required: true },
  play: async (context) => {
    await expect(group(context)).toBeRequired();
  },
};

export const Invalid: Story = {
  args: { required: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)} error={storyText(context, copy.error)}>
      <SegmentedControl options={options(context)} />
    </Field>
  ),
  play: async (context) => {
    await expect(group(context)).toBeInvalid();
    await expect(group(context)).toHaveAccessibleDescription(`${storyText(context, copy.help)} ${storyText(context, copy.error)}`);
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async (context) => {
    for (const option of context.canvas.getAllByRole("radio")) await expect(option).toBeDisabled();
    await userEvent.tab();
    await expect(document.activeElement).toBe(document.body);
  },
};

/** Read-only: focusable and announced read-only; arrows and clicks keep the value. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <SegmentedControl options={options(context)} defaultValue="board" />
    </Field>
  ),
  play: async (context) => {
    await expect(group(context)).toHaveAttribute("aria-readonly", "true");
    await expectTabFocusRing(segment(context, 1));
    await press(storyLocale(context) === "ar" ? "ArrowLeft" : "ArrowRight");
    await userEvent.click(segment(context, 0));
    await expect(segment(context, 1)).toBeChecked();
  },
};

/** On a phone: every segment is at least 44 × 44px. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    for (const option of context.canvas.getAllByRole("radio")) await expectTouchTarget(option);
  },
};
