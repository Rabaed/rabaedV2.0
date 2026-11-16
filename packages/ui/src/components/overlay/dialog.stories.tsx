import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone, tablet } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { expectCard, expectFocusTrapped, expectFooterPinned, expectFullScreen, overlay } from "../../storybook/overlay.ts";
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

/**
 * On a phone (RP-1312): full screen, its footer at the foot of the screen; the close button, Cancel and Save are all
 * at least 44 × 44px. Left open for the screenshot.
 */
export const Phone: Story = {
  parameters: { ...phone, ...overlay },
  play: async (context) => {
    await expectTouchTarget(trigger(context));
    await userEvent.click(trigger(context));
    const panel = await dialog(context);
    const buttons = within(panel).getAllByRole("button");
    await expect(buttons).toHaveLength(3);
    for (const button of buttons) await expectTouchTarget(button);
    await expectFullScreen(panel);
    await expectFooterPinned(panel);
  },
};

const fields = [
  { en: "Name (English)", ar: "الاسم (بالإنجليزية)" },
  { en: "Name (Arabic)", ar: "الاسم (بالعربية)" },
  { en: "Code", ar: "الرمز" },
  { en: "Client", ar: "العميل" },
  { en: "Consultant", ar: "الاستشاري" },
  { en: "Main Contractor", ar: "المقاول الرئيسي" },
  { en: "City", ar: "المدينة" },
  { en: "District", ar: "الحي" },
  { en: "Plot", ar: "رقم القطعة" },
  { en: "Contract number", ar: "رقم العقد" },
  { en: "Project Manager", ar: "مدير المشروع" },
  { en: "Notes", ar: "ملاحظات" },
];

/**
 * On a phone, a pop-up taller than the screen: the body scrolls under the footer, which stays in view with
 * Cancel and Save on top at every scroll (RP-1312). Left open for the screenshot.
 */
export const PhoneLongBody: Story = {
  parameters: { ...phone, ...overlay },
  render: (_args, context) => (
    <Dialog defaultOpen>
      <DialogContent title={storyText(context, copy.title)} description={storyText(context, copy.description)} closeLabel={storyText(context, copy.close)}>
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          {fields.map((field) => (
            <Field key={field.en} label={storyText(context, field)}>
              <Input />
            </Field>
          ))}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{storyText(context, copy.cancel)}</Button>
            </DialogClose>
            <Button type="submit">{storyText(context, copy.save)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  ),
  play: async (context) => {
    const panel = await dialog(context);
    await expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    await expectFullScreen(panel);
    await expectFooterPinned(panel);
    for (const button of within(panel).getAllByRole("button")) await expectTouchTarget(button);
  },
};

const confirm = {
  trigger: { en: "Delete", ar: "حذف" },
  title: { en: "Delete PKG-001?", ar: "حذف \u2066PKG-001\u2069؟" },
  description: { en: "Its submittals stay as they are, without a Package.", ar: "تبقى اعتماداتها كما هي، دون حزمة." },
  delete: { en: "Delete Package", ar: "حذف الحزمة" },
};

/** A short confirm opts into `phone="card"`: on a phone it stays a centred card, its buttons still 44 px (RP-1312). Left open for the screenshot. */
export const PhoneConfirm: Story = {
  parameters: { ...phone, ...overlay },
  render: (_args, context) => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger">{storyText(context, confirm.trigger)}</Button>
      </DialogTrigger>
      <DialogContent phone="card" title={storyText(context, confirm.title)} description={storyText(context, confirm.description)} closeLabel={storyText(context, copy.close)}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{storyText(context, copy.cancel)}</Button>
          </DialogClose>
          <Button variant="danger">{storyText(context, confirm.delete)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, confirm.trigger) }));
    const panel = await screen.findByRole("dialog", { name: storyText(context, confirm.title) });
    await expectCard(panel);
    for (const button of within(panel).getAllByRole("button")) await expectTouchTarget(button);
  },
};

/** At 820 (a tablet) and wider: the centred card of today, 32rem wide (RP-1312). Left open for the screenshot. */
export const Tablet: Story = {
  parameters: { ...tablet, ...overlay },
  play: async (context) => {
    await userEvent.click(trigger(context));
    const panel = await dialog(context);
    await expectCard(panel);
    await expect(panel.getBoundingClientRect().width).toBe(512);
  },
};
