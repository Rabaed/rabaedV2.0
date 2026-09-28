import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { Field } from "./field.tsx";
import { Switch } from "./switch.tsx";

const copy = {
  label: { en: "Email me updates", ar: "أرسل لي التحديثات بالبريد" },
  help: { en: "A daily summary of Work Items with you.", ar: "ملخص يومي لبنود العمل لديك." },
  error: { en: "Turn this on to continue.", ar: "فعّل هذا الخيار للمتابعة." },
};

const meta = {
  title: "Forms/Switch",
  component: Field,
  args: { label: "", children: null, layout: "inline" },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <Switch />
    </Field>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const toggle = (context: PlayContext) => context.canvas.getByRole("switch", { name: storyText(context, copy.label) });

/** Named by its label and described by its help; Space switches it, and so does clicking the label. */
export const Default: Story = {
  play: async (context) => {
    const control = toggle(context);
    await expect(control).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(control).not.toBeChecked();
    await expectTabFocusRing(control);
    await userEvent.keyboard(" ");
    await expect(control).toBeChecked();
    await userEvent.click(context.canvas.getByText(storyText(context, copy.label)));
    await expect(control).not.toBeChecked();
  },
};

/** On, for the visual baseline. */
export const On: Story = {
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)}>
      <Switch defaultChecked />
    </Field>
  ),
  play: async (context) => {
    await expect(toggle(context)).toBeChecked();
  },
};

export const Required: Story = {
  args: { required: true },
  play: async (context) => {
    await expect(toggle(context)).toHaveAttribute("aria-required", "true");
  },
};

export const Invalid: Story = {
  args: { required: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)} error={storyText(context, copy.error)}>
      <Switch />
    </Field>
  ),
  play: async (context) => {
    const control = toggle(context);
    await expect(control).toBeInvalid();
    await expect(control).toHaveAccessibleDescription(`${storyText(context, copy.help)} ${storyText(context, copy.error)}`);
  },
};

/** Disabled: skipped by Tab, and clicks change nothing. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async (context) => {
    const control = toggle(context);
    await expect(control).toBeDisabled();
    await userEvent.tab();
    await expect(control).not.toHaveFocus();
    await userEvent.click(control, { pointerEventsCheck: 0 });
    await expect(control).not.toBeChecked();
  },
};

/** Read-only: focusable and announced read-only; Space and clicks change nothing. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  render: (args, context) => (
    <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
      <Switch defaultChecked />
    </Field>
  ),
  play: async (context) => {
    const control = toggle(context);
    await expect(control).toHaveAttribute("aria-readonly", "true");
    await expectTabFocusRing(control);
    await userEvent.keyboard(" ");
    await userEvent.click(control);
    await expect(control).toBeChecked();
  },
};

/** On a phone: a 44px touch area around the switch. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) => (
    <div className="p-4">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <Switch />
      </Field>
    </div>
  ),
  play: async (context) => {
    await expectTouchTarget(toggle(context));
  },
};
