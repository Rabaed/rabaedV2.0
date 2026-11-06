"use client";

import { Button, Icon, useToast } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/** Marks every notification read, says so, then shows the list and the bell as they are now; disabled with none unread. */
export function MarkNotificationsRead({ unread }: { unread: number }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function markAll() {
    setPending(true);
    try {
      const res = await fetch("/api/v1/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      toast(res.ok ? { title: t("markedAllRead"), tone: "success" } : { title: t("unavailable"), tone: "danger" });
    } catch {
      toast({ title: t("unavailable"), tone: "danger" });
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  return (
    <Button variant="secondary" disabled={pending || unread === 0} onClick={() => void markAll()}>
      <Icon name="circle-check" />
      {t("markAllRead")}
    </Button>
  );
}
