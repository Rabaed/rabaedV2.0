import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { Button, IconButton } from "./button.tsx";
import { SignButton } from "./sign-button.tsx";

const meta = {
  title: "Components/Button",
  component: Button,
  args: { onClick: fn(), variant: "primary", size: "md", disabled: false },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
  render: (args, context) => (
    <Button {...args}>{storyText(context, { en: "Submit", ar: "إرسال" })}</Button>
  ),
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** Reaching the button with Tab shows the focus ring; Enter and Space both press it. */
async function expectKeyboardOperable({ canvas, args }: PlayContext, name: string) {
  const button = canvas.getByRole("button", { name });
  await userEvent.tab();
  await expect(button).toHaveFocus();

  const style = getComputedStyle(button);
  await expect(style.outlineStyle).toBe("solid");
  await expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);

  await userEvent.keyboard("{Enter}");
  await expect(args.onClick).toHaveBeenCalledTimes(1);
  await userEvent.keyboard(" ");
  await expect(args.onClick).toHaveBeenCalledTimes(2);
}

export const Primary: Story = {
  play: (context) => expectKeyboardOperable(context, storyText(context, { en: "Submit", ar: "إرسال" })),
};

export const Secondary: Story = {
  args: { variant: "secondary" },
  render: (args, context) => <Button {...args}>{storyText(context, { en: "Save draft", ar: "حفظ المسودة" })}</Button>,
  play: (context) => expectKeyboardOperable(context, storyText(context, { en: "Save draft", ar: "حفظ المسودة" })),
};

export const Ghost: Story = {
  args: { variant: "ghost" },
  render: (args, context) => <Button {...args}>{storyText(context, { en: "Cancel", ar: "إلغاء" })}</Button>,
  play: (context) => expectKeyboardOperable(context, storyText(context, { en: "Cancel", ar: "إلغاء" })),
};

export const Danger: Story = {
  args: { variant: "danger" },
  render: (args, context) => <Button {...args}>{storyText(context, { en: "Remove", ar: "إزالة" })}</Button>,
  play: (context) => expectKeyboardOperable(context, storyText(context, { en: "Remove", ar: "إزالة" })),
};

/** A disabled button is announced as disabled, is skipped by Tab and ignores clicks. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async (context) => {
    const { canvas, args } = context;
    const button = canvas.getByRole("button", { name: storyText(context, { en: "Submit", ar: "إرسال" }) });
    await expect(button).toBeDisabled();
    await userEvent.tab();
    await expect(button).not.toHaveFocus();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Small: Story = {
  args: { size: "sm" },
};

/** Icon-only: the required `label` is its accessible name; the icon itself is hidden from assistive tech. */
export const Icon: Story = {
  render: (args, context) => (
    <IconButton {...args} variant={args.variant === "primary" ? "ghost" : args.variant} label={storyText(context, { en: "Add", ar: "إضافة" })}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </IconButton>
  ),
  play: (context) => expectKeyboardOperable(context, storyText(context, { en: "Add", ar: "إضافة" })),
};

/** The signing variant: its name is the action; the ✍ marker is visual only. */
export const Sign: Story = {
  render: (args, context) => <SignButton onClick={args.onClick}>{storyText(context, { en: "Acknowledge", ar: "إقرار" })}</SignButton>,
  play: async (context) => {
    const name = storyText(context, { en: "Acknowledge", ar: "إقرار" });
    await expect(context.canvas.getByRole("button", { name })).toHaveTextContent("✍");
    await expectKeyboardOperable(context, name);
  },
};

/** Every variant side by side, for the visual baseline. */
export const AllVariants: Story = {
  render: (args, context) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="primary">{storyText(context, { en: "Submit", ar: "إرسال" })}</Button>
      <Button {...args} variant="secondary">{storyText(context, { en: "Save draft", ar: "حفظ المسودة" })}</Button>
      <Button {...args} variant="ghost">{storyText(context, { en: "Cancel", ar: "إلغاء" })}</Button>
      <Button {...args} variant="danger">{storyText(context, { en: "Remove", ar: "إزالة" })}</Button>
      <Button {...args} disabled>{storyText(context, { en: "Submit", ar: "إرسال" })}</Button>
      <SignButton onClick={args.onClick}>{storyText(context, { en: "Acknowledge", ar: "إقرار" })}</SignButton>
    </div>
  ),
};
