"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * "Download PDF" on a closed item (RP-620, ADR 0023): its sealed Documental
 * Record, through the api's short-lived signed link. The item read says where
 * the record is (RP-155): "being prepared" while its job and checks run, the
 * button once it is published, and nothing for an item with no record (its
 * checks failed: Rabaed is alerted, and the item shows no record).
 */
export function DownloadRecordButton({ workItemId, status }: { workItemId: string; status: "preparing" | "published" | null }) {
  const t = useTranslations("documentalRecord");
  const [message, setMessage] = useState<string | null>(null);
  if (status === null) return null;
  if (status === "preparing") {
    return (
      <p role="status" className="text-sm text-muted">
        {t("preparing")}
      </p>
    );
  }

  async function download() {
    setMessage(null);
    // Opened at once, so the browser treats it as the click's own window; the URL follows.
    const opened = window.open("", "_blank");
    // The new tab can't reach back into this page.
    if (opened) opened.opener = null;
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/documental-record`);
      if (!res.ok) {
        opened?.close();
        setMessage(res.status === 404 ? t("notReady") : t("unavailable"));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      if (opened) opened.location.href = url;
      else window.location.href = url;
    } catch {
      opened?.close();
      setMessage(t("unavailable"));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={download}>
        {t("download")}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
