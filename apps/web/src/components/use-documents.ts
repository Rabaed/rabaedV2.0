"use client";

import { contentTypeOfFile, type DocumentList, type DocumentSummary, type StartedDocumentUpload } from "@rabaed/domain";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";

// Uploading, opening and removing a Work Item's Documents, for the Attachments
// System Field and the Form's `attachments` and `photos` fields alike (RP-269,
// RP-281, RP-284). The
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

/** The Attachments System Field's Documents have no field key: this key stands for them in `pending`. */
const systemField = "";

export function useDocuments(workItemId: string, limits: DocumentList["limits"]) {
  const t = useTranslations("workItems.attachments");
  const format = useFormatter();
  const router = useRouter();
  /** The field keys with an upload or removal under way (systemField for the System Field). */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const start = (key: string) => setPending((keys) => new Set(keys).add(key));
  const done = (key: string) =>
    setPending((keys) => {
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
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

  /**
   * Uploads files one after another, to the Form's `attachments` or `photos`
   * field `fieldKey`, or to the System Field; stops at the first refused.
   */
  async function upload(files: readonly File[], fieldKey?: string) {
    setMessage(null);
    start(fieldKey ?? systemField);
    let uploaded = false;
    try {
      for (const file of files) {
        if (!(await uploadOne(file, fieldKey))) break;
        uploaded = true;
      }
    } finally {
      done(fieldKey ?? systemField);
      if (uploaded) router.refresh();
    }
  }

  /** Uploads one file; whether it was attached (otherwise the message says why). */
  async function uploadOne(file: File, fieldKey?: string): Promise<boolean> {
    // The same limits the API checks, before sending anything.
    if (file.size > limits.maxBytes) {
      setMessage(t("tooLarge", { size: size(limits.maxBytes) }));
      return false;
    }
    const contentType = contentTypeOfFile(file);
    if (!limits.contentTypes.includes(contentType)) {
      setMessage(t("wrongType"));
      return false;
    }
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, contentType, fieldKey }),
      });
      if (!res.ok) {
        await refused(res);
        return false;
      }
      const started = (await res.json()) as StartedDocumentUpload;
      const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body: file });
      if (!put.ok) {
        setMessage(t("unavailable"));
        return false;
      }
      const confirmed = await fetch(`${base}/${started.id}/confirm`, { method: "POST" });
      if (!confirmed.ok) {
        await refused(confirmed);
        return false;
      }
      setMessage(t("uploaded"));
      return true;
    } catch {
      setMessage(t("unavailable"));
      return false;
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
    start(fieldKey ?? systemField);
    setMessage(null);
    try {
      const res = await fetch(`${base}/${documentId}`, { method: "DELETE" });
      if (!res.ok) return await refused(res);
      setMessage(t("removed"));
      router.refresh();
    } catch {
      setMessage(t("unavailable"));
    } finally {
      done(fieldKey ?? systemField);
    }
  }

  return {
    upload,
    open,
    remove,
    size,
    message,
    /** Whether the System Field's upload or removal is under way. */
    systemPending: pending.has(systemField),
    /** The keys with an upload or removal under way: the Form's fields read their own. */
    pending,
  };
}

/** Browsers show these image types; a HEIC photo shows an icon until opened. */
const shownImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Short-lived image URLs for the photos among `documents`, by Document id, for
 * their thumbnails: the same download URLs the API signs for opening them.
 */
export function useImageUrls(workItemId: string, documents: readonly DocumentSummary[]): Readonly<Record<string, string>> {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const wanted = documents.filter((d) => shownImageTypes.has(d.contentType)).map((d) => d.id);
  const missing = wanted.filter((id) => !(id in urls)).join(",");
  useEffect(() => {
    if (!missing) return;
    let current = true;
    void Promise.all(
      missing.split(",").map(async (id) => {
        const res = await fetch(`/api/v1/work-items/${workItemId}/documents/${id}/download`).catch(() => null);
        return res?.ok ? ([id, ((await res.json()) as { url: string }).url] as const) : null;
      }),
    ).then((found) => {
      if (current) setUrls((known) => ({ ...known, ...Object.fromEntries(found.filter((f) => f !== null)) }));
    });
    return () => {
      current = false;
    };
  }, [workItemId, missing]);
  return urls;
}
