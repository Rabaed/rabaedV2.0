"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/** Marks every notification read, then shows the list and the bell as they are now. */
export function MarkNotificationsRead() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function markAll() {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/v1/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) setFailed(true);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => void markAll()}>
        {t("markAllRead")}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t("unavailable")}
        </p>
      )}
    </div>
  );
}
