"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { itemPdfProblemMessage, openItemPdf } from "@/lib/item-pdf";

/**
 * "Download PDF" on an item that isn't closed (RP-621; visibility.md, the Working Copy row): its
 * Working Copy, watermarked and unsealed, the same file for every viewer. The worker prints it on
 * the first ask, so the button says so while it waits. Once the item has closed, the item page
 * shows the record's button instead (DownloadRecordButton).
 */
export function DownloadWorkingCopyButton({ workItemId }: { workItemId: string }) {
  const t = useTranslations("documentalRecord");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    setMessage(null);
    setPending(true);
    const problem = await openItemPdf(workItemId, false);
    setPending(false);
    if (problem) setMessage(t(itemPdfProblemMessage(problem)));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={download} disabled={pending}>
        {t("download")}
      </Button>
      {(pending || message) && (
        <p role="status" className="text-sm text-muted">
          {pending ? t("workingCopyPreparing") : message}
        </p>
      )}
    </div>
  );
}
