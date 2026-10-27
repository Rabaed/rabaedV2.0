"use client";

import {
  checklistItemFilesKey,
  contentTypeOfFile,
  type DocumentList,
  type DocumentSummary,
  type StartDocumentUploadRequest,
  type StartedDocumentUpload,
} from "@rabaed/domain";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { annotatedCopyFile, annotatedCopyRequest } from "@/lib/annotated-copy";

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

/**
 * Uploads one file to a Work Item: the API signs a URL for exactly this file, the browser puts it in
 * the file store, and the API is told it's there. `refused` is the API's refusal code (or
 * `unavailable` when the file store or the network failed).
 */
export function uploadToWorkItem(
  workItemId: string,
  file: File,
  { fieldKey, itemKey, reply = false }: { fieldKey?: string; itemKey?: string; reply?: boolean } = {},
): Promise<UploadResult> {
  return uploadDocument(workItemId, file, { fileName: file.name, sizeBytes: file.size, contentType: contentTypeOfFile(file), fieldKey, itemKey, ...(reply ? { reply: true } : {}) });
}

type UploadResult = { ok: true } | { ok: false; refused: string; status?: number };

/** The three steps of an upload, for the file `request` declares. */
async function uploadDocument(workItemId: string, file: File, request: StartDocumentUploadRequest): Promise<UploadResult> {
  const base = `/api/v1/work-items/${workItemId}/documents`;
  const refusal = async (res: Response) => ({ ok: false as const, status: res.status, refused: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "unavailable" });
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) return await refusal(res);
    const started = (await res.json()) as StartedDocumentUpload;
    const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body: file });
    if (!put.ok) return { ok: false, refused: "unavailable" };
    const confirmed = await fetch(`${base}/${started.id}/confirm`, { method: "POST" });
    return confirmed.ok ? { ok: true } : await refusal(confirmed);
  } catch {
    return { ok: false, refused: "unavailable" };
  }
}

/** The Attachments System Field's Documents have no field key: this key stands for them in `pending`. */
const systemField = "";

/** What stands for a field's (or a checklist item's) Documents in `pending`. */
const pendingKeyOf = (fieldKey?: string, itemKey?: string) =>
  fieldKey === undefined ? systemField : itemKey === undefined ? fieldKey : checklistItemFilesKey(fieldKey, itemKey);

/**
 * `reply`: the fields are a reply Screen's (ADR 0024), whose files the holding Participant adds
 * for the Transition that takes them. `onChanged`: called after a file is added or removed, as
 * well as the page refreshing (a pop-up keeps its own list).
 */
export function useDocuments(workItemId: string, limits: DocumentList["limits"], { reply = false, onChanged }: { reply?: boolean; onChanged?: () => void } = {}) {
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
    refusedWith(body.error, res.status);
  }
  function refusedWith(error: string | undefined, status?: number) {
    setMessage(t(refusals[error ?? ""] ?? "unavailable", { size: size(limits.maxBytes) }));
    if (status === 404 || status === 409) router.refresh();
  }

  /**
   * Uploads files one after another, to the Form's `attachments` or `photos`
   * field `fieldKey` (or, as evidence, to the item `itemKey` of its `checklist`
   * field), or to the System Field; stops at the first refused.
   */
  async function upload(files: readonly File[], fieldKey?: string, itemKey?: string) {
    setMessage(null);
    const pendingKey = pendingKeyOf(fieldKey, itemKey);
    start(pendingKey);
    let uploaded = false;
    try {
      for (const file of files) {
        if (!(await uploadOne(file, fieldKey, itemKey))) break;
        uploaded = true;
      }
    } finally {
      done(pendingKey);
      if (uploaded) {
        router.refresh();
        onChanged?.();
      }
    }
  }

  /** Uploads one file; whether it was attached (otherwise the message says why). */
  async function uploadOne(file: File, fieldKey?: string, itemKey?: string): Promise<boolean> {
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
    const result = await uploadToWorkItem(workItemId, file, { fieldKey, itemKey, reply });
    if (!result.ok) {
      refusedWith(result.refused, result.status);
      return false;
    }
    setMessage(t("uploaded"));
    return true;
  }

  /**
   * Stores `image`, drawn in the annotate view, as the annotated copy of photo `original` (RP-656,
   * RP-1056), beside it: the api puts it in the original's field and item, read by exactly who reads
   * the original. Throws when refused, so the annotate view keeps its marks; the message says why.
   */
  async function saveAnnotated(original: Pick<DocumentSummary, "id" | "fileName">, image: Blob) {
    setMessage(null);
    const file = annotatedCopyFile(original.fileName, image);
    const result = await uploadDocument(workItemId, file, annotatedCopyRequest(original.id, file));
    if (!result.ok) {
      if (result.refused === "document_frozen") {
        setMessage(t("annotateFrozen"));
        router.refresh();
      } else refusedWith(result.refused, result.status);
      throw new Error(result.refused);
    }
    setMessage(t("annotatedSaved"));
    router.refresh();
    onChanged?.();
  }

  /** `saveAnnotated` for a photo among `documents`, by its id: the Form engine's `onSaveAnnotated`. */
  const annotatesIn =
    (documents: readonly DocumentSummary[]) =>
    (originalId: string, image: Blob): Promise<void> => {
      const original = documents.find((d) => d.id === originalId);
      return original ? saveAnnotated(original, image) : Promise.reject(new Error("not_found"));
    };

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

  async function remove(documentId: string, fieldKey?: string, itemKey?: string) {
    const pendingKey = pendingKeyOf(fieldKey, itemKey);
    start(pendingKey);
    setMessage(null);
    try {
      const res = await fetch(`${base}/${documentId}`, { method: "DELETE" });
      if (!res.ok) return await refused(res);
      setMessage(t("removed"));
      router.refresh();
      onChanged?.();
    } catch {
      setMessage(t("unavailable"));
    } finally {
      done(pendingKey);
    }
  }

  return {
    upload,
    saveAnnotated,
    annotatesIn,
    open,
    remove,
    size,
    message,
    /** Whether the System Field's upload or removal is under way. */
    systemPending: pending.has(systemField),
    /** The keys with an upload or removal under way: the Form's fields (and a checklist's items) read their own. */
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
  return usePhotoUrls(documents.map((d) => ({ workItemId, documentId: d.id, contentType: d.contentType })));
}

/**
 * Short-lived image URLs for photos of any items, by Document id (an item page's thumbnails,
 * the Snag List's rows, RP-94): only those of a type the browser shows, each asked once.
 */
export function usePhotoUrls(photos: readonly { workItemId: string; documentId: string; contentType: string }[]): Readonly<Record<string, string>> {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const missing = photos
    .filter((p) => shownImageTypes.has(p.contentType) && !(p.documentId in urls))
    .map((p) => `${p.workItemId}/${p.documentId}`)
    .join(",");
  useEffect(() => {
    if (!missing) return;
    let current = true;
    void Promise.all(
      missing.split(",").map(async (key) => {
        const [workItemId, id] = key.split("/") as [string, string];
        const res = await fetch(`/api/v1/work-items/${workItemId}/documents/${id}/download`).catch(() => null);
        return res?.ok ? ([id, ((await res.json()) as { url: string }).url] as const) : null;
      }),
    ).then((found) => {
      if (current) setUrls((known) => ({ ...known, ...Object.fromEntries(found.filter((f) => f !== null)) }));
    });
    return () => {
      current = false;
    };
  }, [missing]);
  return urls;
}
