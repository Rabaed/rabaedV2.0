"use client";

import { CHAT_MESSAGE_MAX_LENGTH, formatNumber, type Locale, type WorkItemChat, type WorkItemDetail } from "@rabaed/domain";
import { SubmittalPanelChat, submittalPanelChatOpen, type SubmittalPanelChatLabels, type SubmittalPanelTabItem } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** The Chat read for one item: its thread, or that it couldn't be read (hidden, gone or failed: the same to the viewer). */
type ChatRead = { id: string; ok: true; chat: WorkItemChat } | { id: string; ok: false };

/**
 * The Submittal Panel's Chat tab (RP-1069, spec RP-1054 decision C1): the item's thread from the Chat
 * read (`GET /v1/work-items/:id/chat`, RP-1062), which gives another Company's author as its name and
 * Project Role only (V14), and posting to it. Shown as the read gives it; nothing is worked out here
 * about who wrote what. Before the Submission Date nothing is read: Chat isn't open yet, and the tab
 * shows its empty state. After a post the thread is read again, so the message and the tab's count
 * appear without a reload.
 */
export function useSubmittalPanelChatTab({ item, locale, refreshKey }: { item: WorkItemDetail; locale: Locale; refreshKey: unknown }): SubmittalPanelTabItem {
  const t = useTranslations("submittalPanelChat");
  const open = submittalPanelChatOpen(item.submissionDate);
  const [read, setRead] = useState<ChatRead | null>(null);
  const [posted, setPosted] = useState(0);
  const chatUrl = `/api/v1/work-items/${item.id}/chat`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const id = item.id;
    // A read again that fails keeps the thread already shown; a new item's says it couldn't be read.
    const failed = () => setRead((shown) => (shown?.id === id && shown.ok ? shown : { id, ok: false }));
    fetch(chatUrl, { signal: controller.signal })
      .then(async (res) => (res.ok ? setRead({ id, ok: true, chat: (await res.json()) as WorkItemChat }) : failed()))
      .catch(() => {
        if (!controller.signal.aborted) failed();
      });
    return () => controller.abort();
  }, [item.id, chatUrl, open, refreshKey, posted]);

  const tooLong = t("tooLong", { max: formatNumber(CHAT_MESSAGE_MAX_LENGTH, locale) });
  const labels: SubmittalPanelChatLabels = {
    log: t("tab"),
    closed: { title: t("closedTitle"), body: t("closedBody") },
    none: t("none"),
    composer: t("composer"),
    send: t("send"),
    hint: t("keys"),
    tooLong,
  };
  const refusals: Record<string, string> = {
    not_submitted: t("notSubmitted"),
    invalid_body: tooLong,
    project_closed: t("projectClosed"),
  };
  async function send(body: string): Promise<string | null> {
    try {
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.status === 201) {
        setPosted((n) => n + 1);
        return null;
      }
      const refused = (await res.json().catch(() => null)) as { error?: string } | null;
      return refusals[refused?.error ?? ""] ?? t("sendFailed");
    } catch {
      return t("sendFailed");
    }
  }

  const ready = open && read?.id === item.id ? read : null;
  // Before the Submission Date nothing is read: the tab shows its empty state.
  const content = !open || ready?.ok ? (
    <SubmittalPanelChat locale={locale} labels={labels} open={open} messages={ready?.ok ? ready.chat.messages : []} onSend={send} />
  ) : !ready ? (
    <p role="status" className="px-5 py-6 text-sm text-muted">
      {t("loading")}
    </p>
  ) : (
    <p role="alert" className="px-5 py-6 text-sm text-muted">
      {t("unavailable")}
    </p>
  );

  return { key: "chat", label: t("tab"), count: ready?.ok ? ready.chat.count : undefined, content };
}
