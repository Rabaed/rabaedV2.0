"use client";

import { formatDate, type BaseRole, type Locale, type WorkItemChat } from "@rabaed/domain";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Avatar } from "../data/avatar.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import { submittalPanelChatAuthor, submittalPanelChatDraft, submittalPanelChatSends } from "./panel-chat-model.ts";

export type SubmittalPanelChatLabels = {
  /** Names the thread for screen readers: "Chat". */
  log: string;
  /** Before the Submission Date (owner decision C1). */
  closed: { title: string; body: string };
  /** An open Chat no one has written in yet. */
  none: string;
  /** The text box's name and placeholder. */
  composer: string;
  send: string;
  /** "Enter to send · Shift+Enter for a new line". */
  hint: string;
  /** The text is longer than the API takes. */
  tooLong: string;
};

export type SubmittalPanelChatProps = {
  locale: Locale;
  labels: SubmittalPanelChatLabels;
  /** From the item's Submission Date on (`submittalPanelChatOpen`); before it the composer is off and the empty state shows. */
  open: boolean;
  /** The Chat read's messages, oldest first, exactly as it gives them. */
  messages: WorkItemChat["messages"];
  /** Posts the text; resolves to null once posted (the composer then clears), or the reason it wasn't to show. */
  onSend: (body: string) => Promise<string | null>;
};

/** A Project Role's badge colours and icon (README §4.4: Contractor orange, Consultant blue, Owner green). */
const roleLook: Record<BaseRole, { icon: IconName; tint: string; fg: string }> = {
  contractor: { icon: "crane", tint: "var(--trade-su-bg)", fg: "var(--trade-su-fg)" },
  consultant: { icon: "ruler", tint: "var(--info-tint)", fg: "var(--info-fg)" },
  owner: { icon: "building", tint: "var(--success-tint)", fg: "var(--success-fg)" },
  owner_representative: { icon: "buildings", tint: "var(--stage-pending-bg)", fg: "var(--stage-pending-fg)" },
};

/** A Company, in its Project Role's colour and icon. */
function ChatCompanyBadge({ company, baseRole }: { company: string; baseRole: BaseRole }) {
  const look = roleLook[baseRole];
  return (
    <span className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-[7px] px-1.5 font-medium" style={{ background: look.tint, color: look.fg }}>
      <Icon name={look.icon} size={13} className="shrink-0" />
      <span dir="auto" className="truncate">
        {company}
      </span>
    </span>
  );
}

/**
 * The Submittal Panel's Chat tab (RP-1069, README §5): the item's thread as bubbles, oldest first and
 * scrolled to the newest, the reader's own on the inline-end side in the brand tint. Each shows its
 * author exactly as the Chat read gives them: the reader's own Company's Member by name, another
 * Company by its name and Project Role only (V14). Text only; nothing is edited or deleted. Enter
 * sends, Shift+Enter adds a line.
 */
export function SubmittalPanelChat({ locale, labels, open, messages, onSend }: SubmittalPanelChatProps) {
  const ids = useId();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const state = submittalPanelChatDraft(draft);

  // The newest in view when the tab opens and when one is added.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send() {
    if (!open || state !== "ready" || sending) return;
    setSending(true);
    setError(null);
    try {
      const refused = await onSend(draft);
      if (refused === null) setDraft("");
      else setError(refused);
    } finally {
      setSending(false);
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!submittalPanelChatSends({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
    event.preventDefault();
    void send();
  };

  const hintId = `${ids}-hint`;
  const problemId = `${ids}-problem`;
  const problem = error ?? (state === "too_long" ? labels.tooLong : null);

  return (
    <div className="sdp-chat flex flex-col gap-4 px-5 py-4 @[880px]/sdp:px-7 @[880px]/sdp:py-5">
      {!open ? (
        <EmptyState icon="message-circle" title={labels.closed.title} className="py-8">
          {labels.closed.body}
        </EmptyState>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted">{labels.none}</p>
      ) : (
        <div role="log" aria-label={labels.log} className="flex flex-col gap-4">
          {messages.map((message) => {
            const author = submittalPanelChatAuthor(message.author, locale);
            return (
              <div key={message.id} data-mine={message.mine || undefined} className={cn("sdp-chat-message flex max-w-[560px] gap-2.5", message.mine && "ms-auto flex-row-reverse")}>
                {author.person === null ? <Avatar name={author.company} kind="company" size="sm" decorative /> : <Avatar name={author.person} size="sm" decorative />}
                <div className="min-w-0">
                  <div className={cn("mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]", message.mine && "justify-end")}>
                    {author.person !== null && (
                      <b dir="auto" className="font-semibold">
                        {author.person}
                      </b>
                    )}
                    <ChatCompanyBadge company={author.company} baseRole={author.baseRole} />
                    <span dir="auto" className="text-muted">
                      {author.role}
                    </span>
                    <time dateTime={message.at} className="text-[11px] text-muted">
                      {formatDate(new Date(message.at), locale, { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </div>
                  <p
                    dir="auto"
                    className={cn("m-0 rounded-[12px] px-3 py-2.5 text-[13.5px] leading-normal break-words whitespace-pre-line", message.mine ? "bg-brand-tint" : "bg-surface-subtle")}
                  >
                    {message.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div ref={end} className="flex flex-col gap-1.5">
        <form onSubmit={onSubmit} aria-label={labels.log} className="flex items-end gap-2">
          <Textarea
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={!open}
            aria-label={labels.composer}
            placeholder={labels.composer}
            aria-describedby={[open ? hintId : null, problem === null ? null : problemId].filter(Boolean).join(" ") || undefined}
            aria-invalid={state === "too_long" || undefined}
            dir="auto"
            className="max-h-40 min-h-[38px] flex-1 resize-none [field-sizing:content]"
          />
          <IconButton type="submit" variant="primary" label={labels.send} disabled={!open || state !== "ready" || sending} className="size-[38px]">
            <Icon name="send" />
          </IconButton>
        </form>
        {open && (
          <p id={hintId} className="text-[11px] text-muted">
            {labels.hint}
          </p>
        )}
        {problem !== null && (
          <p id={problemId} role="alert" className="text-sm text-danger-fg">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
