import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { Field } from "./field.tsx";
import { Select } from "./select.tsx";

const copy = {
  label: { en: "Trade", ar: "التخصص" },
  help: { en: "Decides who reviews it.", ar: "يحدد من يراجعه." },
  error: { en: "Choose a Trade.", ar: "اختر التخصص." },
  placeholder: { en: "Choose a Trade", ar: "اختر التخصص" },
};

const options = (context: StoryContext) => [
  { value: "civil", label: storyText(context, { en: "Civil", ar: "مدني" }) },
  { value: "electrical", label: storyText(context, { en: "Electrical", ar: "كهرباء" }) },
  { value: "mechanical", label: storyText(context, { en: "Mechanical", ar: "ميكانيكا" }) },
  { value: "landscape", label: storyText(context, { en: "Landscape", ar: "تنسيق المواقع" }), disabled: true },
];

const meta = {
  title: "Forms/Select",
  component: Field,
  args: { label: "", children: null },
  render: (args, context) => (
    <div className="max-w-sm">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <Select options={options(context)} placeholder={storyText(context, copy.placeholder)} />
      </Field>
    </div>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const combobox = (context: PlayContext) => context.canvas.getByRole("combobox", { name: storyText(context, copy.label) });
// The open list renders in a portal at the end of <body>, outside the story.
const listbox = () => screen.findByRole("listbox");

/** Named by its label, described by its help; Enter opens the list, arrows move, Enter chooses, Escape closes. */
export const Default: Story = {
  play: async (context) => {
    const trigger = combobox(context);
    await expect(trigger).toHaveAccessibleDescription(storyText(context, copy.help));
    await expect(trigger).toHaveTextContent(storyText(context, copy.placeholder));
    await expectTabFocusRing(trigger);

    await userEvent.keyboard("{Enter}");
    await expect(await listbox()).toBeVisible();
    await expect(screen.getByRole("option", { name: options(context)[3]!.label })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(trigger).toHaveTextContent(options(context)[1]!.label);
    await expect(trigger).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await listbox();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(trigger).toHaveTextContent(options(context)[1]!.label);
  },
};

export const Required: Story = {
  args: { required: true },
  play: async (context) => {
    await expect(combobox(context)).toBeRequired();
  },
};

export const Invalid: Story = {
  args: { required: true },
  render: (args, context) => (
    <div className="max-w-sm">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)} error={storyText(context, copy.error)}>
        <Select options={options(context)} placeholder={storyText(context, copy.placeholder)} />
      </Field>
    </div>
  ),
  play: async (context) => {
    await expect(combobox(context)).toBeInvalid();
    await expect(combobox(context)).toHaveAccessibleDescription(`${storyText(context, copy.help)} ${storyText(context, copy.error)}`);
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async (context) => {
    await expect(combobox(context)).toBeDisabled();
    await userEvent.tab();
    await expect(combobox(context)).not.toHaveFocus();
  },
};

/** Read-only: focusable and announced read-only, shows its value, and never opens. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  render: (args, context) => (
    <div className="max-w-sm">
      <Field {...args} label={storyText(context, copy.label)} help={storyText(context, copy.help)}>
        <Select options={options(context)} defaultValue="mechanical" />
      </Field>
    </div>
  ),
  play: async (context) => {
    const trigger = combobox(context);
    await expect(trigger).toHaveAttribute("aria-readonly", "true");
    await expect(trigger).toHaveTextContent(options(context)[2]!.label);
    await expectTabFocusRing(trigger);
    await userEvent.keyboard("{Enter}");
    await userEvent.click(trigger);
    await expect(screen.queryByRole("listbox")).toBeNull();
    // Typeahead on the closed trigger changes nothing either.
    await userEvent.keyboard("c");
    await expect(trigger).toHaveTextContent(options(context)[2]!.label);
  },
};

/** Resolves once the open list has stopped moving (it is positioned after it opens). */
async function listSettled() {
  let last = "";
  await waitFor(() => {
    const now = JSON.stringify(screen.getAllByRole("option").map((option) => option.getBoundingClientRect().top));
    const settled = now === last;
    last = now;
    expect(settled).toBe(true);
  });
}

/** On a phone: tapping opens the list; the trigger and every option are at least 44px tall. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const trigger = combobox(context);
    await expectTouchTarget(trigger);
    await userEvent.click(trigger);
    await listbox();
    await listSettled();
    for (const option of screen.getAllByRole("option")) await expectTouchTarget(option);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  },
};
