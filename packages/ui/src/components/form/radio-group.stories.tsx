import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone, press } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { Field } from "./field.tsx";
import { RadioGroup } from "./radio-group.tsx";

const copy = {
  label: { en: "Review Code", ar: "رمز المراجعة" },
  help: { en: "Code B needs a comment.", ar: "الرمز B يتطلب تعليقًا." },
  error: { en: "Choose a Review Code.", ar: "اختر رمز المراجعة." },
};

const options = (context: StoryContext) => [
  { value: "a", label: storyText(context, { en: "A: Approved", ar: "A: معتمد" }) },
  { value: "b", label: storyText(context, { en: "B: Approved with comments", ar: "B: معتمد مع ملاحظات" }) },
  { value: "c", label: storyText(context, { en: "C: Revise and resubmit", ar: "C: يُعدّل ويُعاد تقديمه" }) },
  { value: "d", label: storyText(context, { en: "D: Rejected", ar: "D: مرفوض" }), disabled: true },
];

const meta = {
  title: "Forms/RadioGroup",
  component: Field,
  args: { label: "", children: null, group: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <RadioGroup options={options(context)} />
    </Field>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const group = (context: PlayContext) => context.canvas.getByRole("radiogroup", { name: storyText(context, copy.label) });
const radio = (context: PlayContext, index: number) => context.canvas.getAllByRole("radio")[index]!;

/** The group is named by its label and described by its help; Tab enters it; arrows choose; disabled options are skipped. */
export const Default: Story = {
  play: async (context) => {
    await expect(group(context)).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(radio(context, 0)).toHaveAccessibleName(options(context)[0]!.label);
    await expectTabFocusRing(radio(context, 0));
    await userEvent.keyboard(" ");
    await expect(radio(context, 0)).toBeChecked();
    await press("ArrowDown");
    await expect(radio(context, 1)).toBeChecked();
    await press("ArrowDown");
    await press("ArrowDown");
    // D is disabled, so focus wraps from C back to A.
    await expect(radio(context, 0)).toBeChecked();
    await expect(radio(context, 3)).toBeDisabled();
    await userEvent.click(context.canvas.getByText(options(context)[2]!.label));
    await expect(radio(context, 2)).toBeChecked();
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
      <RadioGroup options={options(context)} />
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
      <RadioGroup options={options(context)} defaultValue="b" />
    </Field>
  ),
  play: async (context) => {
    await expect(group(context)).toHaveAttribute("aria-readonly", "true");
    await expectTabFocusRing(radio(context, 1));
    await press("ArrowDown");
    await userEvent.click(context.canvas.getByText(options(context)[0]!.label));
    await expect(radio(context, 1)).toBeChecked();
  },
};

/** On a phone: every option has a 44px touch area, spaced so they don't overlap. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) => (
    <div className="p-4">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <RadioGroup options={options(context)} />
      </Field>
    </div>
  ),
  play: async (context) => {
    for (const option of context.canvas.getAllByRole("radio")) await expectTouchTarget(option);
  },
};
