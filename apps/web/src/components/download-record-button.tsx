"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

type RecordStatus = "preparing" | "published" | null;

/**
 * Downloading a closed item's Documental Record (RP-620): `canDownload` once it is published,
 * `download` opens it, and `message` says what the button can't ("being prepared", or why it
 * couldn't be opened), null when there is nothing to say. The Work Item page shows the button in its
 * top bar and the message under it (RP-1188, gap table row 6).
 */
export function useRecordDownload(workItemId: string, status: RecordStatus) {
  const t = useTranslations("documentalRecord");
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setProblem(null);
    // Opened at once, so the browser treats it as the click's own window; the URL follows.
    const opened = window.open("", "_blank");
    // The new tab can't reach back into this page.
    if (opened) opened.opener = null;
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/documental-record`);
      if (!res.ok) {
        opened?.close();
        setProblem(res.status === 404 ? t("notReady") : t("unavailable"));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      if (opened) opened.location.href = url;
      else window.location.href = url;
    } catch {
      opened?.close();
      setProblem(t("unavailable"));
    }
  }

  return { download, canDownload: status === "published", label: t("download"), message: status === "preparing" ? t("preparing") : status === "published" ? problem : null };
}

/**
 * "Download PDF" on a closed item (RP-620, ADR 0023): its sealed Documental
 * Record, through the api's short-lived signed link. The item read says where
 * the record is (RP-155): "being prepared" while its job and checks run, the
 * button once it is published, and nothing for an item with no record (its
 * checks failed: Rabaed is alerted, and the item shows no record).
 */
export function DownloadRecordButton({ workItemId, status }: { workItemId: string; status: RecordStatus }) {
  const { download, canDownload, label, message } = useRecordDownload(workItemId, status);
  if (status === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDownload && (
        <Button variant="secondary" size="sm" onClick={download}>
          {label}
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
