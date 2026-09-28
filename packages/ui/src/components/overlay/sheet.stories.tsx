import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { expectFocusTrapped, overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Field } from "../form/field.tsx";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetTrigger } from "./sheet.tsx";

const copy = {
  trigger: { en: "Filters", ar: "عوامل التصفية" },
  title: { en: "Filter Work Items", ar: "تصفية بنود العمل" },
  description: { en: "Show only what matters to you now.", ar: "اعرض ما يهمك الآن فقط." },
  withMe: { en: "With me", ar: "لديّ" },
  electrical: { en: "Electrical", ar: "كهرباء" },
  apply: { en: "Apply", ar: "تطبيق" },
  reset: { en: "Reset", ar: "إعادة تعيين" },
  close: { en: "Close", ar: "إغلاق" },
};

function FilterSheet({ context }: { context: StoryContext }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary">{t(copy.trigger)}</Button>
      </SheetTrigger>
      <SheetContent title={t(copy.title)} description={t(copy.description)} closeLabel={t(copy.close)}>
        <Field label={t(copy.withMe)} layout="inline">
          <Checkbox defaultChecked />
        </Field>
        <Field label={t(copy.electrical)} layout="inline">
          <Checkbox />
        </Field>
        <SheetFooter>
          <Button variant="ghost">{t(copy.reset)}</Button>
          <SheetClose asChild>
            <Button>{t(copy.apply)}</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const meta = {
  title: "Overlays/Sheet",
  render: (_args, context) => <FilterSheet context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const trigger = (context: PlayContext) => context.canvas.getByRole("button", { name: storyText(context, copy.trigger) });
const sheet = (context: PlayContext) => screen.findByRole("dialog", { name: storyText(context, copy.title) });

/**
 * Open: slides in from the inline-end side, the right in English and the left
 * in Arabic, full height; focus is trapped inside. Left open for the screenshot.
 */
export const Open: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(trigger(context));
    const panel = await sheet(context);
    await expect(panel).toHaveAccessibleDescription(storyText(context, copy.description));

    const box = panel.getBoundingClientRect();
    await expect(box.height).toBe(innerHeight);
    await expect(box.width).toBeLessThan(innerWidth / 2);
    if (storyLocale(context) === "ar") await expect(box.left).toBe(0);
    else await expect(box.right).toBe(innerWidth);

    await expectFocusTrapped(panel);
  },
};

/** Keyboard: Escape closes it and focus returns to the button that opened it; so does Apply. */
export const Closing: Story = {
  play: async (context) => {
    trigger(context).focus();
    await userEvent.keyboard("{Enter}");
    await sheet(context);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(trigger(context)).toHaveFocus();

    await userEvent.click(trigger(context));
    await sheet(context);
    await userEvent.click(screen.getByRole("button", { name: storyText(context, copy.apply) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(trigger(context)).toHaveFocus();
  },
};
