import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { WatchButton, type WatchCall } from "./watch-button.tsx";

// The Watch / Watching button on the item page (RP-354, spec RP-344): the
// viewer's own Watch only, never a list or count of watchers. Story data only.
const copy = {
  watch: { en: "Watch", ar: "مراقبة" },
  watching: { en: "Watching", ar: "قيد المراقبة" },
  gone: { en: "This item is no longer available to you.", ar: "لم يعد هذا البند متاحًا لك." },
};

const ok: WatchCall = async () => ({ ok: true });

const meta = {
  title: "Work Items/WatchButton",
  component: WatchButton,
  args: { locale: "en", watching: false, onChange: fn<WatchCall>(ok) },
  render: (args, context) => <WatchButton {...args} locale={storyLocale(context)} />,
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof WatchButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Not watching: "Watch", not pressed. Pressing it watches the item, and it reads "Watching". */
export const NotWatching: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const button = canvas.getByRole("button", { name: storyText(context, copy.watch) });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    await expect(args.onChange).toHaveBeenCalledWith(true);
    await expect(await canvas.findByRole("button", { name: storyText(context, copy.watching) })).toHaveAttribute("aria-pressed", "true");
  },
};

/** Watching (the raiser, say): "Watching", pressed. Pressing it stops, and it reads "Watch" again. */
export const Watching: Story = {
  args: { watching: true },
  play: async (context) => {
    const { canvas, args } = context;
    const button = canvas.getByRole("button", { name: storyText(context, copy.watching) });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    // Only the viewer's own state: nothing about who else watches, nor how many.
    await expect(canvas.queryByText(/\d/)).toBeNull();
    await userEvent.click(button);
    await expect(args.onChange).toHaveBeenCalledWith(false);
    await expect(await canvas.findByRole("button", { name: storyText(context, copy.watch) })).toHaveAttribute("aria-pressed", "false");
  },
};

/** Refused (the item left the viewer's sight meanwhile): it stays as it was and says so, naming nothing. */
export const Refused: Story = {
  args: { onChange: fn<WatchCall>(async () => ({ ok: false, reason: "not_found" })) },
  play: async (context) => {
    const { canvas } = context;
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.watch) }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(storyText(context, copy.gone));
    await expect(canvas.getByRole("button", { name: storyText(context, copy.watch) })).toHaveAttribute("aria-pressed", "false");
  },
};

/** At phone width: the button is touch-sized. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expectTouchTarget(context.canvas.getByRole("button", { name: storyText(context, copy.watch) }));
  },
};
