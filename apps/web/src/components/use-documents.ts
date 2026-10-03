"use client";

import type { DocumentList, StartedDocumentUpload } from "@rabaed/domain";
import { contentTypeOf } from "@rabaed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

// Uploading, opening and removing a Work Item's Documents, for the Attachments
// System Field and the Form's `attachments` fields alike (RP-269, RP-281). The
// file goes straight from the browser to the file store through a short-lived
// URL the API signs; the API is told once it's there. The page is refreshed
// after a change, so the lists come back from the API.

const refusals: Record<string, string> = {
  file_too_large: "tooLarge",
  content_type_not_allowed: "wrongType",
  not_editable: "notEditable",
  document_frozen: "frozen",
  forbidden: "forbidden",
  project_closed: "projectClosed",
  not_uploaded: "notUploaded",
  upload_mismatch: "notUploaded",
  too_many_files: "tooManyFiles",
  field_not_found: "unavailable",
};

/** The System Field's uploads have no field key: this stands for them in `pending`. */
const systemField = "";

export function useDocuments(workItemId: string, limits: DocumentList["limits"]) {
  const t = useTranslations("workItems.attachments");
  const format = useFormatter();
  const router = useRouter();
  /** The field key whose upload or removal is under way (systemField for the System Field), or null. */
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const base = `/api/v1/work-items/${workItemId}/documents`;

  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? t("kb", { size: format.number(Math.max(1, Math.round(bytes / 1024)), { numberingSystem: "latn" }) })
      : t("mb", { size: format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1, numberingSystem: "latn" }) });

  async function refused(res: Response) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(t(refusals[body.error ?? ""] ?? "unavailable", { size: size(limits.maxBytes) }));
    if (res.status === 404 || res.status === 409) router.refresh();
  }

  /** Uploads one file, to the Form's `attachments` field `fieldKey`, or to the System Field. */
  async function upload(file: File, fieldKey?: string) {
    setMessage(null);
    // The same limits the API checks, before sending anything.
    if (file.size > limits.maxBytes) return setMessage(t("tooLarge", { size: size(limits.maxBytes) }));
    const contentType = contentTypeOf(file);
    if (!limits.contentTypes.includes(contentType)) return setMessage(t("wrongType"));
    setPending(fieldKey ?? systemField);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, contentType, fieldKey }),
      });
      if (!res.ok) return await refused(res);
      const started = (await res.json()) as StartedDocumentUpload;
      const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body: file });
      if (!put.ok) return setMessage(t("unavailable"));
      const confirmed = await fetch(`${base}/${started.id}/confirm`, { method: "POST" });
      if (!confirmed.ok) return await refused(confirmed);
      setMessage(t("uploaded"));
      router.refresh();
    } catch {
      setMessage(t("unavailable"));
    } finally {
      setPending(null);
    }
  }

  async function open(documentId: string) {
    setMessage(null);
    // Opened at once, so the browser treats it as the click's own window; the URL follows.
    const opened = window.open("", "_blank");
    try {
      const res = await fetch(`${base}/${documentId}/download`);
      if (!res.ok) {
        opened?.close();
        return await refused(res);
      }
      const { url } = (await res.json()) as { url: string };
      if (opened) opened.location.href = url;
      else window.location.href = url;
    } catch {
      opened?.close();
      setMessage(t("unavailable"));
    }
  }

  async function remove(documentId: string, fieldKey?: string) {
    setPending(fieldKey ?? systemField);
    setMessage(null);
    try {
      const res = await fetch(`${base}/${documentId}`, { method: "DELETE" });
      if (!res.ok) return await refused(res);
      setMessage(t("removed"));
      router.refresh();
    } catch {
      setMessage(t("unavailable"));
    } finally {
      setPending(null);
    }
  }

  return {
    upload,
    open,
    remove,
    size,
    message,
    /** Whether the System Field's upload or removal is under way. */
    systemPending: pending === systemField,
    /** The Form fields with an upload or removal under way. */
    fieldsPending: new Set(pending !== null && pending !== systemField ? [pending] : []),
  };
}
