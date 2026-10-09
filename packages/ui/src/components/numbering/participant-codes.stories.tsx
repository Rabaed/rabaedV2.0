import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { participantCodesLabels } from "../../storybook/numbering.ts";
import { ParticipantCodes, type ParticipantCodesProps } from "./participant-codes.tsx";

// Participant Codes on Project Settings → Document Numbering (RP-381, spec RP-311;
// kit-style table in the RP-412 rebuild). A Project Admin sets them in place; a code
// a number fixed shows a lock; every other Project Member reads the Participants the
// API lists for them (their own Company's, V15), without their order on the Project
// (RP-381-1). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const pCcm = "00000000-0000-4000-8000-000000000301";
const pElectro = "00000000-0000-4000-8000-000000000302";
const pKns = "00000000-0000-4000-8000-000000000303";

const all: ParticipantCodesProps["participants"] = [
  { id: pCcm, company: { legalName: b("Contracting Co.", "شركة المقاولات") }, code: "CCM", ordinal: 1, codeLocked: false },
  { id: pElectro, company: { legalName: b("Electro Works", "الأعمال الكهربائية") }, code: null, ordinal: 2, codeLocked: false },
  { id: pKns, company: { legalName: b("Consult Partners", "شركاء الاستشارات") }, code: "KNS", ordinal: 3, codeLocked: true },
];

const ok = async () => ({ ok: true as const });

const meta = {
  title: "Numbering/ParticipantCodes",
  component: ParticipantCodes,
  args: { locale: "en", participants: all, canEdit: true, labels: participantCodesLabels.en, onSave: fn<ParticipantCodesProps["onSave"]>(ok) },
  render: (args, context) => (
    <ParticipantCodes {...args} locale={storyLocale(context)} labels={participantCodesLabels[storyLocale(context)]} />
  ),
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof ParticipantCodes>;

export default meta;
type Story = StoryObj<typeof meta>;

const labels = (context: { globals: Record<string, unknown> }) => participantCodesLabels[storyLocale(context)];
const name = (context: { globals: Record<string, unknown> }, en: string, ar: string) => (storyLocale(context) === "en" ? en : ar);

/** A Project Admin sets Electro Works' code in its row; it is sent as typed, and the row says it is saved. A fixed code shows a lock. */
export const SetCode: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const text = labels(context);
    const company = name(context, "Electro Works", "الأعمال الكهربائية");
    // Without a code, its numbers print its order on the Project, in its own column.
    await expect(canvas.getByRole("columnheader", { name: text.colOrder })).toBeVisible();
    await expect(canvas.getByText("02")).toHaveAttribute("dir", "ltr");
    // No Save button per row: the pencil edits the code in place, Enter saves.
    await expect(canvas.queryByRole("textbox")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: text.editOf(company) }));
    const input = canvas.getByRole("textbox", { name: text.codeOf(company) });
    await expect(input).toHaveFocus();
    await expect(input).toHaveAttribute("dir", "ltr");
    await userEvent.type(input, "elw{Enter}");
    await expect(args.onSave).toHaveBeenCalledWith(pElectro, "ELW");
    await expect(await canvas.findByRole("status")).toHaveTextContent(text.saved);
    await expect(canvas.getByRole("button", { name: text.editOf(company) })).toHaveFocus();
    // KNS is fixed: no pencil, a lock.
    await expect(canvas.queryByRole("button", { name: text.editOf(name(context, "Consult Partners", "شركاء الاستشارات")) })).toBeNull();
    await expect(canvas.getByText(text.locked)).toBeVisible();
  },
};

/** A code a Document Number already uses can't change: the refusal shows on that row. */
export const CodeInUse: Story = {
  args: { onSave: fn<ParticipantCodesProps["onSave"]>(async () => ({ ok: false as const, reason: "code_in_use" })) },
  play: async (context) => {
    const { canvas } = context;
    const text = labels(context);
    const company = name(context, "Contracting Co.", "شركة المقاولات");
    await userEvent.click(canvas.getByRole("button", { name: text.editOf(company) }));
    const input = canvas.getByRole("textbox", { name: text.codeOf(company) });
    await expect(input).toHaveValue("CCM");
    await userEvent.clear(input);
    await userEvent.type(input, "CCX");
    // Leaving the box saves; the refusal stays on the row, the box open.
    await userEvent.tab();
    await expect(await canvas.findByRole("alert")).toHaveTextContent(text.refusals.code_in_use);
    await expect(input).toBeInTheDocument();
  },
};

/** Escape puts the code back without saving. */
export const EscapeCancels: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const text = labels(context);
    const company = name(context, "Contracting Co.", "شركة المقاولات");
    await userEvent.click(canvas.getByRole("button", { name: text.editOf(company) }));
    await userEvent.type(canvas.getByRole("textbox", { name: text.codeOf(company) }), "Z{Escape}");
    await expect(canvas.queryByRole("textbox")).toBeNull();
    await expect(canvas.getByText("CCM")).toBeVisible();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** Another Project Member reads the codes of the Participants listed for them: no box, no button, no order. */
export const ReadOnly: Story = {
  args: { canEdit: false, participants: [{ ...all[0]!, ordinal: null }] },
  play: async (context) => {
    const { canvas } = context;
    const text = labels(context);
    await expect(canvas.queryByRole("textbox")).toBeNull();
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvas.queryByRole("columnheader", { name: text.colOrder })).toBeNull();
    const table = canvas.getByRole("region", { name: text.participants });
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
    const code = within(table).getByText("CCM");
    await expect(code).toHaveAttribute("dir", "ltr");
    await expectLaidOutLeftToRight(code);
  },
};

/**
 * Read-only, for a Participant without a code: a plain "no code yet". The API gives
 * its order on the Project only to Project Admins, since the order would count the
 * other Participants (visibility.md RP-381-1).
 */
export const ReadOnlyNoCode: Story = {
  args: { canEdit: false, participants: [{ ...all[1]!, ordinal: null }] },
  play: async (context) => {
    const { canvas } = context;
    const text = labels(context);
    await expect(canvas.getByText(text.noCode)).toBeVisible();
    await expect(canvas.getByRole("region", { name: text.participants })).not.toHaveTextContent(/\d/);
  },
};

/** At phone width: every pencil is touch-sized, and the box fits its row. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const text = labels(context);
    for (const button of context.canvas.getAllByRole("button", { name: /./ })) await expectTouchTarget(button);
    const company = name(context, "Electro Works", "الأعمال الكهربائية");
    await userEvent.click(context.canvas.getByRole("button", { name: text.editOf(company) }));
    await expectTouchTarget(context.canvas.getByRole("textbox", { name: text.codeOf(company) }));
  },
};
