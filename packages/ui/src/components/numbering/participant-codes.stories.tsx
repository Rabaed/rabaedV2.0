import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { participantCodesLabels } from "../../storybook/numbering.ts";
import { ParticipantCodes, type ParticipantCodesProps } from "./participant-codes.tsx";

// Participant Codes on Project Settings → Numbering (RP-381, spec RP-311). A
// Project Admin sets them; every other Project Member reads the Participants the
// API lists for them (their own Company's, V15). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const pCcm = "00000000-0000-4000-8000-000000000301";
const pElectro = "00000000-0000-4000-8000-000000000302";
const pKns = "00000000-0000-4000-8000-000000000303";

const all: ParticipantCodesProps["participants"] = [
  { id: pCcm, company: { legalName: b("Contracting Co.", "شركة المقاولات") }, code: "CCM", ordinal: 1 },
  { id: pElectro, company: { legalName: b("Electro Works", "الأعمال الكهربائية") }, code: null, ordinal: 2 },
  { id: pKns, company: { legalName: b("Consult Partners", "شركاء الاستشارات") }, code: "KNS", ordinal: 3 },
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

/** A Project Admin sets Electro Works' code; it is sent as typed, and the row says it is saved. */
export const SetCode: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const text = labels(context);
    const row = within(canvas.getByRole("form", { name: storyLocale(context) === "en" ? "Electro Works" : "الأعمال الكهربائية" }));
    // Without a code, its numbers print its position.
    await expect(row.getByText("02")).toHaveAttribute("dir", "ltr");
    await expect(row.getByText(text.position)).toBeVisible();
    const input = row.getByRole("textbox", { name: text.code });
    await expect(input).toHaveAttribute("dir", "ltr");
    await userEvent.type(input, "ELW");
    await userEvent.click(row.getByRole("button", { name: text.save }));
    await expect(args.onSave).toHaveBeenCalledWith(pElectro, "ELW");
    await expect(await row.findByRole("status")).toHaveTextContent(text.saved);
  },
};

/** A code a Document Number already uses can't change: the refusal shows on that row. */
export const CodeInUse: Story = {
  args: { onSave: fn<ParticipantCodesProps["onSave"]>(async () => ({ ok: false as const, reason: "code_in_use" })) },
  play: async (context) => {
    const { canvas } = context;
    const text = labels(context);
    const row = within(canvas.getByRole("form", { name: storyLocale(context) === "en" ? "Contracting Co." : "شركة المقاولات" }));
    const input = row.getByRole("textbox", { name: text.code });
    await expect(input).toHaveValue("CCM");
    await userEvent.clear(input);
    await userEvent.type(input, "CCX");
    await userEvent.click(row.getByRole("button", { name: text.save }));
    await expect(await row.findByRole("alert")).toHaveTextContent(text.refusals.code_in_use);
  },
};

/** Another Project Member reads the codes of the Participants listed for them: no box, no button. */
export const ReadOnly: Story = {
  args: { canEdit: false, participants: [all[0]!] },
  play: async (context) => {
    const { canvas } = context;
    const text = labels(context);
    await expect(canvas.queryByRole("textbox")).toBeNull();
    await expect(canvas.queryByRole("button")).toBeNull();
    const list = canvas.getByRole("list", { name: text.participants });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    const code = within(list).getByText("CCM");
    await expect(code).toHaveAttribute("dir", "ltr");
    await expectLaidOutLeftToRight(code);
  },
};

/** Read-only, for a Participant without a code: its position, as its numbers print it. */
export const ReadOnlyPosition: Story = {
  args: { canEdit: false, participants: [all[1]!] },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByText("02")).toHaveAttribute("dir", "ltr");
    await expect(canvas.getByText(labels(context).position)).toBeVisible();
  },
};

/** At phone width: every Save button is touch-sized. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    for (const button of context.canvas.getAllByRole("button", { name: labels(context).save })) await expectTouchTarget(button);
  },
};
