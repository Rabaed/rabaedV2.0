import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./popover.tsx";

const copy = {
  trigger: { en: "About Step Age", ar: "عن عمر الخطوة" },
  title: { en: "Step Age", ar: "عمر الخطوة" },
  body: {
    en: "Dots show how many weeks a Work Item has been at its current step: one per week, up to four.",
    ar: "تبين النقاط عدد الأسابيع التي قضاها بند العمل في خطوته الحالية: نقطة لكل أسبوع، حتى أربع.",
  },
  done: { en: "Got it", ar: "فهمت" },
};

function StepAgePopover({ context }: { context: StoryContext }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <div className="p-4">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary">{t(copy.trigger)}</Button>
        </PopoverTrigger>
        <PopoverContent aria-label={t(copy.title)}>
          <h3 className="mb-1 text-body font-semibold">{t(copy.title)}</h3>
          <p className="text-sm text-muted">{t(copy.body)}</p>
          <PopoverClose asChild>
            <Button size="sm" className="mt-3">
              {t(copy.done)}
            </Button>
          </PopoverClose>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const meta = {
  title: "Overlays/Popover",
  render: (_args, context) => <StepAgePopover context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const trigger = (context: PlayContext) => context.canvas.getByRole("button", { name: storyText(context, copy.trigger) });
const panel = (context: PlayContext) => screen.findByRole("dialog", { name: storyText(context, copy.title) });

/**
 * Open: below its trigger, aligned to the trigger's start edge (the left in
 * English, the right in Arabic). Left open for the screenshot.
 */
export const Open: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(trigger(context));
    const content = await panel(context);
    await waitFor(async () => {
      const [button, box] = [trigger(context).getBoundingClientRect(), content.getBoundingClientRect()];
      await expect(box.top).toBeGreaterThan(button.bottom);
      if (storyLocale(context) === "ar") await expect(Math.round(box.right)).toBe(Math.round(button.right));
      else await expect(Math.round(box.left)).toBe(Math.round(button.left));
    });
  },
};

/** Keyboard: Enter opens it and moves focus inside; Escape, or its own close button, closes it and returns focus to the trigger. */
export const Keyboard: Story = {
  play: async (context) => {
    trigger(context).focus();
    await userEvent.keyboard("{Enter}");
    const content = await panel(context);
    await waitFor(() => expect(content.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(trigger(context)).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await panel(context);
    await userEvent.click(screen.getByRole("button", { name: storyText(context, copy.done) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(trigger(context)).toHaveFocus();
  },
};
