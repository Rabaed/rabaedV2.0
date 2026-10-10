import type { Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { HandoverDialog, type HandoverDialogLabels, type HandoverDialogProps } from "./handover-dialog.tsx";

// The Handover dialog (RP-108): deactivating Ali Sonour, who holds a Step at
// Contractor review and a Draft. Story data only; the labels are what the app
// passes from its messages (apps/web/messages).
const labels: Record<Locale, HandoverDialogLabels> = {
  en: {
    title: "Hand over Ali Sonour's Steps",
    description: "Ali Sonour holds these. Choose who takes each one before Ali Sonour is deactivated.",
    noNumber: "No number yet",
    newHolder: "New holder",
    choose: "Choose who takes it",
    cancel: "Cancel",
    confirm: "Hand over and deactivate",
    close: "Close",
  },
  ar: {
    title: "تسليم خطوات Ali Sonour",
    description: "هذه الخطوات لدى Ali Sonour. اختر من يتولى كل خطوة قبل إيقاف Ali Sonour.",
    noNumber: "بلا رقم بعد",
    newHolder: "المتولّي الجديد",
    choose: "اختر من يتولاها",
    cancel: "إلغاء",
    confirm: "سلّم وأوقف",
    close: "إغلاق",
  },
};

const project = { id: "00000000-0000-4000-8000-0000000000a1", name: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" } };
const khalid = { id: "00000000-0000-4000-8000-0000000000b1", fullName: { en: "Khalid Bakr", ar: "خالد بكر" } };
const badr = { id: "00000000-0000-4000-8000-0000000000b2", fullName: { en: "Badr Alawi", ar: "بدر العلوي" } };
const saad = { id: "00000000-0000-4000-8000-0000000000b3", fullName: { en: "Saad Harbi", ar: "سعد الحربي" } };
const steps: HandoverDialogProps["steps"] = [
  {
    assignmentId: "00000000-0000-4000-8000-0000000000c1",
    workItemId: "00000000-0000-4000-8000-0000000000d1",
    project,
    documentNumber: "TWR-MAR-CCM-0007",
    title: "Cable trays, Level 2",
    step: { en: "Contractor review", ar: "مراجعة المقاول" },
    candidates: [badr, khalid],
  },
  {
    assignmentId: "00000000-0000-4000-8000-0000000000c2",
    workItemId: "00000000-0000-4000-8000-0000000000d2",
    project,
    documentNumber: null,
    title: "Chillers",
    step: { en: "Draft", ar: "مسودة" },
    candidates: [saad],
  },
];

const meta = {
  title: "People/HandoverDialog",
  component: HandoverDialog,
  args: { open: true, onOpenChange: fn(), steps, locale: "en", labels: labels.en, onConfirm: fn<HandoverDialogProps["onConfirm"]>() },
  render: (args, context) => <HandoverDialog {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} />,
  parameters: overlay,
} satisfies Meta<typeof HandoverDialog>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const dialog = (context: PlayContext) => screen.findByRole("dialog", { name: labels[storyLocale(context)].title });
const confirm = (context: PlayContext) => screen.getByRole("button", { name: labels[storyLocale(context)].confirm });

/**
 * Each Step with its Project, Document Number (or "No number yet" for a Draft),
 * Subject and Step. The only candidate is filled in; with two, nothing is, and the
 * change can't be sent until each Step has someone. Left open for the screenshot.
 */
export const ChoosesForEachStep: Story = {
  play: async (context) => {
    const l = labels[storyLocale(context)];
    const panel = await dialog(context);
    const pickers = within(panel).getAllByRole("combobox");
    await expect(pickers).toHaveLength(2);
    await expect(pickers[0]).toHaveTextContent(l.choose);
    await expect(pickers[1]).toHaveTextContent(saad.fullName[storyLocale(context)]);
    await expect(within(panel).getByText(l.noNumber, { exact: false })).toBeVisible();
    await expect(confirm(context)).toBeDisabled();

    await userEvent.click(pickers[0]!);
    await userEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: khalid.fullName[storyLocale(context)] }));
    await waitFor(() => expect(confirm(context)).toBeEnabled());
    await userEvent.click(confirm(context));
    await expect(context.args.onConfirm).toHaveBeenCalledWith([
      { assignmentId: steps[0]!.assignmentId, toMemberId: khalid.id },
      { assignmentId: steps[1]!.assignmentId, toMemberId: saad.id },
    ]);
  },
};

/** The Document Number reads left to right whole, in Arabic too (CLAUDE.md). */
export const NumbersLeftToRight: Story = {
  play: async (context) => {
    const panel = await dialog(context);
    await expectLaidOutLeftToRight(within(panel).getByText("TWR-MAR-CCM-0007"));
  },
};

/** A refusal (another try needed) shows above the buttons. */
export const Refused: Story = {
  args: { error: "Something changed while you chose. Check the list again." },
  play: async (context) => {
    const panel = await dialog(context);
    await expect(within(panel).getByRole("alert")).toHaveTextContent("Something changed");
  },
};

/** On a phone: the list scrolls inside the dialog. Left open for the screenshot. */
export const Phone: Story = {
  parameters: { ...phone, ...overlay },
  play: async (context) => {
    await dialog(context);
  },
};
