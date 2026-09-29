import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { expectFocusTrapped, overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "./dialog.tsx";

const copy = {
  trigger: { en: "Rename Project", ar: "إعادة تسمية المشروع" },
  title: { en: "Rename Project", ar: "إعادة تسمية المشروع" },
  description: { en: "Everyone in the Project sees the new name.", ar: "يرى جميع أعضاء المشروع الاسم الجديد." },
  field: { en: "Project name", ar: "اسم المشروع" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  save: { en: "Save", ar: "حفظ" },
  close: { en: "Close", ar: "إغلاق" },
};

function RenameDialog({ context }: { context: StoryContext }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">{t(copy.trigger)}</Button>
      </DialogTrigger>
      <DialogContent title={t(copy.title)} description={t(copy.description)} closeLabel={t(copy.close)}>
        <Field label={t(copy.field)}>
          <Input defaultValue={storyText(context, { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" })} />
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t(copy.cancel)}</Button>
          </DialogClose>
          <Button>{t(copy.save)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta = {
  title: "Overlays/Dialog",
  render: (_args, context) => <RenameDialog context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const trigger = (context: PlayContext) => context.canvas.getByRole("button", { name: storyText(context, copy.trigger) });
const dialog = (context: PlayContext) => screen.findByRole("dialog", { name: storyText(context, copy.title) });

/** Open: named by its title, described by its text, and focus is trapped inside. Left open for the screenshot. */
export const Open: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(trigger(context));
    const panel = await dialog(context);
    await expect(panel).toHaveAccessibleDescription(storyText(context, copy.description));
    await expectFocusTrapped(panel);
  },
};

/** Keyboard: Enter opens it, Escape closes it, and focus returns to the button that opened it. */
export const EscapeCloses: Story = {
  play: async (context) => {
    trigger(context).focus();
    await userEvent.keyboard("{Enter}");
    await dialog(context);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(trigger(context)).toHaveFocus();
  },
};

/** The close button and Cancel both close it and return focus to the trigger. */
export const ButtonsClose: Story = {
  play: async (context) => {
    for (const name of [copy.close, copy.cancel]) {
      await userEvent.click(trigger(context));
      await dialog(context);
      await userEvent.click(screen.getByRole("button", { name: storyText(context, name) }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await expect(trigger(context)).toHaveFocus();
    }
  },
};

/** On a phone: the close button, Cancel and Save are all at least 44 × 44px. Left open for the screenshot. */
export const Phone: Story = {
  parameters: { ...phone, ...overlay },
  play: async (context) => {
    await expectTouchTarget(trigger(context));
    await userEvent.click(trigger(context));
    const panel = await dialog(context);
    const buttons = within(panel).getAllByRole("button");
    await expect(buttons).toHaveLength(3);
    for (const button of buttons) await expectTouchTarget(button);
  },
};
