import type { Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { WithdrawParticipantDialog, type WithdrawParticipantDialogLabels } from "./withdraw-participant-dialog.tsx";

// Withdrawing a Participant (RP-952, ADR 0028): the Host Company's Project Admin confirms with the
// counts only, and is told plainly there is no undo. The reference's Remove confirmation
// (Rabaed Participants.html, `.amd`) gives the look. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  company: b("Design Consultants LLC", "ديزاين للاستشارات"),
  project: b("Riyadh Gate Tower", "برج بوابة الرياض"),
  role: b("Consultant", "الاستشاري"),
  confirm: b("Withdraw", "سحب"),
  cancel: b("Cancel", "إلغاء"),
  items: b("3 items it raised will be Cancelled by Rabaed", "3 عناصر قدّمها ستُلغى من رابض"),
  steps: b("1 Step it holds will wait for a new Consultant", "خطوة واحدة لديه ستنتظر الاستشاري الجديد"),
  noUndo: b("This can't be undone.", "لا يمكن التراجع عن هذا."),
  counting: b("Counting…", "جارٍ العدّ…"),
  refused: b("This can't be done right now. Try again.", "تعذّر ذلك الآن. حاول مرة أخرى."),
};

function labelsFor(locale: Locale): WithdrawParticipantDialogLabels {
  const en = locale === "en";
  return {
    title: (company, project) => (en ? `Withdraw ${company} from ${project}?` : `سحب ${company} من ${project}؟`),
    description: en
      ? "Its Members lose the Project at once. Everything it did stays: its moves, replies, Documents and signatures."
      : "يفقد أعضاؤه المشروع فورًا. يبقى كل ما فعله: تحريكاته وردوده ومستنداته وتواقيعه.",
    itemsToCancel: (n, count) =>
      en ? `${n} ${count === 1 ? "item" : "items"} it raised will be Cancelled by Rabaed` : count === 1 ? "عنصر واحد قدّمه سيُلغى من رابض" : `${n} عناصر قدّمها ستُلغى من رابض`,
    stepsToVacate: (n, count, role) =>
      en ? `${n} ${count === 1 ? "Step it holds" : "Steps it holds"} will wait for a new ${role}` : count === 1 ? `خطوة واحدة لديه ستنتظر ${role} الجديد` : `${n} خطوات لديه ستنتظر ${role} الجديد`,
    countsInclude: en ? "The counts include items you may not see." : "تشمل الأعداد عناصر قد لا تراها.",
    noUndo: en ? "This can't be undone." : "لا يمكن التراجع عن هذا.",
    comeBack: en ? "The Company can come back only through a new Invitation." : "لا تعود الشركة إلا بدعوة جديدة.",
    counting: copy.counting[locale],
    cancel: copy.cancel[locale],
    confirm: copy.confirm[locale],
    close: en ? "Close" : "إغلاق",
  };
}

const meta = {
  title: "Participants/Withdraw a Participant",
  parameters: { overlay: true },
  args: { onConfirm: fn(), onOpenChange: fn() },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <WithdrawParticipantDialog
        open
        onOpenChange={args.onOpenChange}
        onConfirm={args.onConfirm}
        companyName={copy.company[locale]}
        projectName={copy.project[locale]}
        roleName={copy.role[locale]}
        preview={args.preview === undefined ? { itemsToCancel: 3, stepsToVacate: 1 } : args.preview}
        pending={args.pending}
        error={args.error ? copy.refused[locale] : null}
        locale={locale}
        labels={labelsFor(locale)}
      />
    );
  },
} satisfies Meta<{
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  preview?: { itemsToCancel: number; stepsToVacate: number } | null;
  pending?: boolean;
  error?: boolean;
}>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () => screen.getByRole("dialog");

/** The counts only, never an item; it says plainly there is no undo, and Withdraw is the red, last button. */
export const Confirm: Story = {
  play: async (context) => {
    const d = dialog();
    await expect(within(d).getByRole("heading", { name: storyText(context, { en: "Withdraw Design Consultants LLC from Riyadh Gate Tower?", ar: "سحب ديزاين للاستشارات من برج بوابة الرياض؟" }) })).toBeVisible();
    await expect(within(d).getByText(storyText(context, copy.items))).toBeVisible();
    await expect(within(d).getByText(storyText(context, copy.steps))).toBeVisible();
    await expect(within(d).getByText(storyText(context, copy.noUndo))).toBeVisible();
    const buttons = within(d).getAllByRole("button").filter((el) => el.textContent !== "");
    await expect(buttons.at(-1)).toHaveTextContent(storyText(context, copy.confirm));
    await userEvent.click(within(d).getByRole("button", { name: storyText(context, copy.confirm) }));
    await expect(context.args.onConfirm).toHaveBeenCalledOnce();
  },
};

/** While the counts load, the confirm button waits: nobody withdraws without seeing them. */
export const Counting: Story = {
  args: { preview: null },
  play: async (context) => {
    await expect(within(dialog()).getByText(storyText(context, copy.counting))).toBeVisible();
    await expect(within(dialog()).getByRole("button", { name: storyText(context, copy.confirm) })).toBeDisabled();
  },
};

/** A Participant with nothing open: zero of each, said as such. */
export const NothingOpen: Story = {
  args: { preview: { itemsToCancel: 0, stepsToVacate: 0 } },
  play: async (context) => {
    await expect(within(dialog()).getByText(storyText(context, { en: "0 items it raised will be Cancelled by Rabaed", ar: "0 عناصر قدّمها ستُلغى من رابض" }))).toBeVisible();
  },
};

/** Refused (someone withdrew it first, say): the reason above the buttons, the dialog still open. */
export const Refused: Story = {
  args: { error: true },
  play: async (context) => {
    await expect(within(dialog()).getByRole("alert")).toHaveTextContent(storyText(context, copy.refused));
  },
};

/** On a phone: a bottom sheet, as the reference's Remove confirmation. */
export const Phone: Story = { parameters: { phone: true } };
