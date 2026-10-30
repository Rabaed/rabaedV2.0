import type { ChatAuthor, Locale, WorkItemChat } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { SubmittalPanelChat, type SubmittalPanelChatLabels } from "./panel-chat.tsx";
import { submittalPanelChatOpen } from "./panel-chat-model.ts";
import { SubmittalPanelTabs } from "./panel-tabs.tsx";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

type Bi = Record<Locale, string>;
const bi = (en: string, ar: string): Bi => ({ en, ar });

const copy = {
  module: bi("Submittals", "التقديمات"),
  previous: bi("Previous submittal", "التقديم السابق"),
  next: bi("Next submittal", "التقديم التالي"),
  close: bi("Close", "إغلاق"),
  hint: bi("Esc to close · ↑ ↓ to move through the list", "Esc للإغلاق · ↑ ↓ للتنقل في القائمة"),
  tabs: bi("Submittal", "التقديم"),
  details: bi("Details", "التفاصيل"),
  chat: bi("Chat", "المحادثة"),
  closedTitle: bi("Chat isn't open yet", "المحادثة لم تُفتح بعد"),
  closedBody: bi("Chat opens once the item is Submitted to the next Participant.", "تُفتح المحادثة بعد تقديم العنصر إلى المشارك التالي."),
  none: bi("No one has written in Chat yet.", "لم يكتب أحد في المحادثة بعد."),
  composer: bi("Write in Chat", "اكتب في المحادثة"),
  send: bi("Send", "إرسال"),
  keys: bi("Enter to send · Shift+Enter for a new line", "Enter للإرسال · Shift+Enter لسطر جديد"),
  tooLong: bi("At most 4000 characters.", "4000 حرف على الأكثر."),
  refused: bi("Couldn't send. Try again.", "تعذّر الإرسال. حاول مرة أخرى."),
};

const labelsOf = (locale: Locale): SubmittalPanelChatLabels => ({
  log: copy.chat[locale],
  closed: { title: copy.closedTitle[locale], body: copy.closedBody[locale] },
  none: copy.none[locale],
  composer: copy.composer[locale],
  send: copy.send[locale],
  hint: copy.keys[locale],
  tooLong: copy.tooLong[locale],
});

// The reader is Sara, an engineer at Dar Consult, the Consultant. The thread is as the Chat read gives it to her (V14).
const roles = {
  contractor: { baseRole: "contractor" as const, name: bi("Main Contractor", "المقاول الرئيسي") },
  consultant: { baseRole: "consultant" as const, name: bi("Consultant", "الاستشاري") },
  owner: { baseRole: "owner" as const, name: bi("Owner", "المالك") },
};
const tmc = bi("TMC Constructions", "تي إم سي للمقاولات");
const dar = bi("Dar Consult", "دار للاستشارات");
const sara = bi("Sara Al-Otaibi", "سارة العتيبي");
const khalid = bi("Khalid Nasser", "خالد ناصر");
/** A Contractor engineer's name: the read never gives it to the Consultant, and the panel must never show it. */
const hiddenPerson = bi("Hafiz Rahman", "حافظ رحمن");

const contractorAuthor: ChatAuthor = { kind: "other", companyName: tmc, projectRole: roles.contractor };
const thread: WorkItemChat["messages"] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    // Even if a person's name came with another Company's author, it is never shown.
    author: { ...contractorAuthor, memberName: hiddenPerson } as ChatAuthor,
    mine: false,
    body: "The sample panel is at the site office.\nPlease confirm the colour before Thursday's visit.",
    at: "2026-10-20T07:15:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    author: { kind: "own", memberName: khalid, companyName: dar, projectRole: roles.consultant },
    mine: false,
    body: "I'll check it against the specification.",
    at: "2026-10-20T08:40:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    author: { kind: "own", memberName: sara, companyName: dar, projectRole: roles.consultant },
    mine: true,
    body: "Colour matches RAL 9016. Go ahead.",
    at: "2026-10-20T10:05:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    author: { kind: "other", companyName: bi("Riyadh Gate Development", "تطوير بوابة الرياض"), projectRole: roles.owner },
    mine: false,
    body: "Noted, thank you.",
    at: "2026-10-20T11:30:00.000Z",
  },
];

function ChatDemo({ context, submissionDate, start = [], refuse = false }: { context: StoryContext; submissionDate: string | null; start?: WorkItemChat["messages"]; refuse?: boolean }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState(start);
  const open = submittalPanelChatOpen(submissionDate);
  // As the web app does: post, then read the thread again.
  const onSend = async (body: string) => {
    if (refuse) return copy.refused[locale];
    setMessages((now) => [
      ...now,
      { id: `00000000-0000-4000-8000-${String(now.length + 100).padStart(12, "0")}`, author: { kind: "own", memberName: sara, companyName: dar, projectRole: roles.consultant }, mine: true, body: body.trim(), at: "2026-10-21T06:00:00.000Z" },
    ]);
    return null;
  };
  return (
    <div className="p-4">
      <SubmittalPanel
        locale={locale}
        labels={{
          module: copy.module[locale],
          position: (n, total) => `${n} / ${total}`,
          previous: copy.previous[locale],
          next: copy.next[locale],
          close: copy.close[locale],
          hint: copy.hint[locale],
        }}
        crumb={<DocNo value="TWR-TMC-AR-MAR-031" />}
        onClose={() => undefined}
        labelledBy={ids.labelledBy}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={{ number: "TWR-TMC-AR-MAR-031", revisionNo: null }}
            noNumber=""
            subject="Aluminium window frames"
            numberId={ids.numberId}
            subjectId={ids.subjectId}
          />
        }
        tabs={
          <SubmittalPanelTabs
            locale={locale}
            label={copy.tabs[locale]}
            value={tab}
            onValueChange={setTab}
            tabs={[
              { key: "details", label: copy.details[locale], content: <p className="px-5 py-4 text-sm text-muted">—</p> },
              {
                key: "chat",
                label: copy.chat[locale],
                count: open ? messages.length : undefined,
                content: <SubmittalPanelChat locale={locale} labels={labelsOf(locale)} open={open} messages={messages} onSend={onSend} />,
              },
            ]}
          />
        }
      />
    </div>
  );
}

const submitted = "2026-10-19T09:00:00.000Z";

const meta = {
  title: "Views/Submittal Panel/Chat",
  parameters: overlay,
  render: (_args, context) => <ChatDemo context={context} submissionDate={submitted} start={thread} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const composerOf = (context: PlayContext) => within(panelOf(context)).getByRole("textbox", { name: storyText(context, copy.composer) });
const sendOf = (context: PlayContext) => within(panelOf(context)).getByRole("button", { name: storyText(context, copy.send) });
const bubbles = (context: PlayContext) => [...panelOf(context).querySelectorAll<HTMLElement>(".sdp-chat-message")];

/**
 * UI visibility test (RP-1069-1; V14), as the Consultant: a Contractor message shows the Contractor's
 * Company name and Project Role, never the person, even if a name came with it. The positive control:
 * the reader's own Company's authors are named. Oldest first; the reader's own message sits on the
 * inline-end side in the brand tint.
 */
export const AsTheConsultant: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const panel = panelOf(context);
    await expect(within(panel).getByRole("tab", { name: `${copy.chat[locale]} 4` })).toHaveAttribute("aria-selected", "true");
    const log = within(panel).getByRole("log", { name: copy.chat[locale] });
    const [contractor, own, mine, owner] = bubbles(context);

    await expect(contractor).toHaveTextContent(tmc[locale]);
    await expect(contractor).toHaveTextContent(roles.contractor.name[locale]);
    for (const name of Object.values(hiddenPerson)) await expect(log).not.toHaveTextContent(name);
    await expect(owner).toHaveTextContent(roles.owner.name[locale]);

    // Each Company's badge is the route strip's role tile (RP-1093): one colour per Project Role, in the panel's one role map.
    const tiles = [contractor, own, mine, owner].map((b) => b!.querySelector<HTMLElement>("[data-role-badge] .sdp-role"));
    for (const tile of tiles) await expect(tile).toBeVisible();
    const tint = (tile: HTMLElement | null) => getComputedStyle(tile!).backgroundColor;
    await expect(contractor!.querySelector("[data-role-badge]")).toHaveAttribute("data-role-badge", "contractor");
    await expect(owner!.querySelector("[data-role-badge]")).toHaveAttribute("data-role-badge", "owner");
    await expect(tint(tiles[1]!)).toBe(tint(tiles[2]!));
    await expect(new Set([tint(tiles[0]!), tint(tiles[1]!), tint(tiles[3]!)]).size).toBe(3);

    // Positive control: our own Company's authors by name.
    await expect(own).toHaveTextContent(khalid[locale]);
    await expect(mine).toHaveTextContent(sara[locale]);
    await expect(own).toHaveTextContent(dar[locale]);

    // The newest at the bottom, and the reader's own at the inline end.
    await expect(bubbles(context).map((b) => b.querySelector("p")!.textContent)).toEqual(thread.map((m) => m.body));
    const area = log.getBoundingClientRect();
    const box = mine!.getBoundingClientRect();
    if (locale === "ar") await expect(Math.round(box.left)).toBe(Math.round(area.left));
    else await expect(Math.round(box.right)).toBe(Math.round(area.right));
    await expect(mine).toHaveAttribute("data-mine", "true");
    await expect(contractor).not.toHaveAttribute("data-mine");
    // A message keeps its new lines.
    await expect(getComputedStyle(contractor!.querySelector("p")!).whiteSpace).toBe("pre-line");
  },
};

/** Enter sends and the message joins the thread, with the tab's count; Shift+Enter adds a line; nothing but spaces can't be sent. */
export const Sending: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const panel = panelOf(context);
    const composer = composerOf(context);
    await expect(sendOf(context)).toBeDisabled();
    await userEvent.type(composer, "   ");
    await expect(sendOf(context)).toBeDisabled();
    await userEvent.clear(composer);

    await userEvent.type(composer, "Frames delivered{Shift>}{Enter}{/Shift}to Tower 1");
    await expect(composer).toHaveValue("Frames delivered\nto Tower 1");
    await expect(bubbles(context)).toHaveLength(4);
    await userEvent.keyboard("{Enter}");

    await expect(composer).toHaveValue("");
    await expect(bubbles(context)).toHaveLength(5);
    await expect(bubbles(context).at(-1)!.querySelector("p")).toHaveTextContent("Frames delivered to Tower 1");
    await expect(within(panel).getByRole("tab", { name: `${copy.chat[locale]} 5` })).toBeVisible();
  },
};

/** A refused post keeps what was written and says so. */
export const SendRefused: Story = {
  render: (_args, context) => <ChatDemo context={context} submissionDate={submitted} start={thread} refuse />,
  play: async (context) => {
    const composer = composerOf(context);
    await userEvent.type(composer, "Please resend the samples");
    await userEvent.click(sendOf(context));
    await expect(within(panelOf(context)).getByRole("alert")).toHaveTextContent(storyText(context, copy.refused));
    await expect(composer).toHaveValue("Please resend the samples");
    await expect(bubbles(context)).toHaveLength(4);
  },
};

/** Text longer than the API takes can't be sent, and the composer says why. */
export const TooLong: Story = {
  play: async (context) => {
    const composer = composerOf(context);
    composer.focus();
    await userEvent.paste("a".repeat(4001));
    await expect(sendOf(context)).toBeDisabled();
    await expect(composer).toHaveAttribute("aria-invalid", "true");
    await expect(within(panelOf(context)).getByRole("alert")).toHaveTextContent(storyText(context, copy.tooLong));
  },
};

/** An open Chat no one has written in yet. */
export const NoneYet: Story = {
  render: (_args, context) => <ChatDemo context={context} submissionDate={submitted} />,
  play: async (context) => {
    await expect(within(panelOf(context)).getByText(storyText(context, copy.none))).toBeVisible();
    await expect(composerOf(context)).toBeEnabled();
  },
};

/** Before the Submission Date: the empty state, and the composer is off (owner decision C1). */
export const BeforeSubmission: Story = {
  render: (_args, context) => <ChatDemo context={context} submissionDate={null} />,
  play: async (context) => {
    const panel = panelOf(context);
    await expect(within(panel).getByRole("tab", { name: storyText(context, copy.chat) })).toHaveAttribute("aria-selected", "true");
    await expect(within(panel).getByText(storyText(context, copy.closedBody))).toBeVisible();
    await expect(composerOf(context)).toBeDisabled();
    await expect(sendOf(context)).toBeDisabled();
    await expect(within(panel).queryByRole("log")).toBeNull();
    await expect(within(panel).queryByText(storyText(context, copy.keys))).toBeNull();
  },
};
