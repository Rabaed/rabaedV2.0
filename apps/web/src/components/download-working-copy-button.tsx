"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { itemPdfProblemMessage, openItemPdf } from "@/lib/item-pdf";

/**
 * Downloading an open item's Working Copy (RP-621): `download` opens it, and `message` says what the
 * button can't (it is being printed, or why it couldn't be), null when there is nothing to say. The
 * Work Item page shows the button in its top bar and the message under it (RP-1188, gap table row 6).
 */
export function useWorkingCopyDownload(workItemId: string) {
  const t = useTranslations("documentalRecord");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setProblem(null);
    setPending(true);
    const found = await openItemPdf(workItemId, false);
    setPending(false);
    if (found) setProblem(t(itemPdfProblemMessage(found)));
  }

  return { download, pending, label: t("download"), message: pending ? t("workingCopyPreparing") : problem };
}

/**
 * "Download PDF" on an item that isn't closed (RP-621; visibility.md, the Working Copy row): its
 * Working Copy, watermarked and unsealed, the same file for every viewer. The worker prints it on
 * the first ask, so the button says so while it waits. Once the item has closed, the item page
 * shows the record's button instead (DownloadRecordButton).
 */
export function DownloadWorkingCopyButton({ workItemId }: { workItemId: string }) {
  const { download, pending, label, message } = useWorkingCopyDownload(workItemId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={download} disabled={pending}>
        {label}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
