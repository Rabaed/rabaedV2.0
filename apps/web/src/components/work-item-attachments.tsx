"use client";

import type { DocumentList, Locale, StartedDocumentUpload } from "@rabaed/domain";
import { Button, Icon } from "@rabaed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";

// The Attachments System Field, below the Form (form-engine.md §1): the item's
// Documents, to open, and to upload and remove while the viewer may change them
// (the raiser's Company, in Draft, with Attach). The file goes straight from the
// browser to the file store through a short-lived URL the API signs; the API is
// told once it's there. Sent or submitted, the Documents are frozen.

const refusals: Record<string, string> = {
  file_too_large: "tooLarge",
  content_type_not_allowed: "wrongType",
  not_editable: "notEditable",
  document_frozen: "frozen",
  forbidden: "forbidden",
  project_closed: "projectClosed",
  not_uploaded: "notUploaded",
  upload_mismatch: "notUploaded",
};

// Browsers know no type for some files Documents may be: name it from the extension.
const typesByExtension: Record<string, string> = {
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  heic: "image/heic",
  csv: "text/csv",
};

function contentTypeOf(file: File): string {
  return file.type || typesByExtension[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
}

export function WorkItemAttachments({ workItemId, list, locale }: { workItemId: string; list: DocumentList; locale: Locale }) {
  const t = useTranslations("workItems.attachments");
  const format = useFormatter();
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const base = `/api/v1/work-items/${workItemId}/documents`;

  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? t("kb", { size: format.number(Math.max(1, Math.round(bytes / 1024)), { numberingSystem: "latn" }) })
      : t("mb", { size: format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1, numberingSystem: "latn" }) });

  async function refused(res: Response) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(t(refusals[body.error ?? ""] ?? "unavailable", { size: size(list.limits.maxBytes) }));
    if (res.status === 404 || res.status === 409) router.refresh();
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setMessage(null);
    // The same limits the API checks, before sending anything.
    if (file.size > list.limits.maxBytes) return setMessage(t("tooLarge", { size: size(list.limits.maxBytes) }));
    const contentType = contentTypeOf(file);
    if (!list.limits.contentTypes.includes(contentType)) return setMessage(t("wrongType"));
    setPending(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, contentType }),
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
      setPending(false);
      if (input.current) input.current.value = "";
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

  async function remove(documentId: string) {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/${documentId}`, { method: "DELETE" });
      if (!res.ok) return await refused(res);
      setMessage(t("removed"));
      router.refresh();
    } catch {
      setMessage(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby={`${inputId}-title`} data-testid="work-item-attachments">
      <h2 id={`${inputId}-title`} className="text-h6 font-semibold">
        {t("title")}
      </h2>
      {list.documents.length === 0 ? (
        <p className="text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {list.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 p-3">
              <Icon name="file-text" size={20} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  <bdi>{d.fileName}</bdi>
                </p>
                <p className="text-sm text-muted">
                  {[size(d.sizeBytes), d.uploadedBy.memberName?.[locale], d.uploadedBy.companyName[locale]]
                    .filter(Boolean)
                    .join(" · ")}
                  {d.frozen && ` · ${t("frozenLabel")}`}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void open(d.id)}>
                {t("open")}
              </Button>
              {list.canChange && !d.frozen && (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => void remove(d.id)}>
                  {t("remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.canChange && (
        <div className="space-y-1">
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t("add")}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={list.limits.contentTypes.join(",")}
            disabled={pending}
            onChange={(e) => void upload(e.target.files)}
            className="block text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-sm text-muted">{t("limits", { size: size(list.limits.maxBytes) })}</p>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </section>
  );
}
