"use client";

import { formatNumber, type DocumentList, type Locale, type WorkItemDetail } from "@rabaed/domain";
import {
  SubmittalPanelAttachments,
  submittalPanelAttachmentDocuments,
  type SubmittalPanelAttachmentFile,
  type SubmittalPanelAttachmentsLabels,
  type SubmittalPanelSectionItem,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useFileSize } from "@/components/use-documents";

/** The Documents read for one item: its files, or that they couldn't be read (hidden, gone or failed: the same to the viewer). */
type DocumentsRead = { id: string; ok: true; files: SubmittalPanelAttachmentFile[] } | { id: string; ok: false };

/**
 * The Submittal Panel's Attachments section (RP-1068, spec RP-1054 decision C3): the item's
 * Documents from `GET /v1/work-items/:id/documents`, which lists only what the viewer may see, and
 * each file read only through its short-lived signed URL (`/documents/:docId/download`), which the
 * api issues after its access check: a file the viewer may not see is a 404, so its preview says it
 * couldn't be opened and shows nothing of it. A failed read here leaves the rest of the Details tab
 * as it is.
 */
export function useSubmittalPanelAttachments({ item, locale, refreshKey }: { item: WorkItemDetail; locale: Locale; refreshKey: unknown }): SubmittalPanelSectionItem {
  const t = useTranslations("submittalPanelAttachments");
  const size = useFileSize();
  const [read, setRead] = useState<DocumentsRead | null>(null);
  const documentsUrl = `/api/v1/work-items/${item.id}/documents`;

  useEffect(() => {
    const controller = new AbortController();
    const id = item.id;
    // A read again that fails keeps the files already shown; a new item's says they couldn't be read.
    const failed = () => setRead((shown) => (shown?.id === id && shown.ok ? shown : { id, ok: false }));
    fetch(documentsUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return failed();
        const list = (await res.json()) as DocumentList;
        setRead({
          id,
          ok: true,
          files: submittalPanelAttachmentDocuments(list.documents).map((d) => ({ id: d.id, name: d.fileName, contentType: d.contentType, size: size(d.sizeBytes) })),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) failed();
      });
    return () => controller.abort();
    // `size` words sizes in the page's locale, which a locale change reloads the page for.
  }, [item.id, documentsUrl, refreshKey]);

  const fileUrl = useCallback(
    async (documentId: string) => {
      const res = await fetch(`${documentsUrl}/${documentId}/download`);
      if (!res.ok) throw new Error(`download answered ${res.status}`);
      return ((await res.json()) as { url: string }).url;
    },
    [documentsUrl],
  );

  const ready = read?.id === item.id ? read : null;
  const count = ready?.ok ? ready.files.length : null;
  const labels: SubmittalPanelAttachmentsLabels = {
    kind: { pdf: t("pdf"), image: t("image"), other: t("other") },
    pageCount: (n, pages) => t("pageCount", { count: pages, n }),
    pageOf: (page, pages) => t("pageOf", { page, pages }),
    ofAttachments: (total) => t("ofAttachments", { count: total }),
    page: (n) => t("page", { n }),
    pages: t("pages"),
    files: t("files"),
    none: t("none"),
    preview: t("preview"),
    closePreview: t("closePreview"),
    openLarge: t("openLarge"),
    download: t("download"),
    print: t("print"),
    back: t("back"),
    close: t("close"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    previousPage: t("previousPage"),
    nextPage: t("nextPage"),
    loading: t("loading"),
    unavailable: t("unavailable"),
    tryAgain: t("tryAgain"),
    noPreview: t("noPreview"),
  };

  return {
    key: "attachments",
    icon: "paperclip",
    title: t("title"),
    summary: count === null ? "" : t("fileCount", { count, n: formatNumber(count, locale) }),
    children: !ready ? (
      <p role="status" className="text-[13px] text-muted">
        {t("reading")}
      </p>
    ) : !ready.ok ? (
      <p role="alert" className="text-[13px] text-muted">
        {t("unavailableList")}
      </p>
    ) : (
      // One item's files and what was read of them; another item starts afresh.
      <SubmittalPanelAttachments key={item.id} locale={locale} labels={labels} files={ready.files} fileUrl={fileUrl} />
    ),
  };
}
