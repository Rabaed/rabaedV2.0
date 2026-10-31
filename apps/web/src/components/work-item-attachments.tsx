"use client";

import { isAnnotatedCopy, type DocumentList, type Locale } from "@rabaed/domain";
import { AttachmentChips, Button, Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { useDocuments } from "./use-documents";

// The Attachments System Field, below the Form (form-engine.md §1): the item's
// Documents that belong to no Form field, to open, and to upload and remove
// while the viewer may change them (the Member holding a raiser's Step that
// edits the Form, with Attach). Submitted, the Documents are frozen (ADR 0020). The Form's own
// `attachments` fields show theirs inside the Form (RP-281).

/**
 * `titleHidden`: its heading names the section for screen readers only, where a card already shows it (the Work
 * Item page, RP-1151). `look="chips"`: the Work Item page's chips (RP-1188, gap table row 50), with Open and
 * Remove on each and "Attach a Document" for the holder; the same Documents read, so a close shows only what
 * was handed over (ADR 0027).
 */
export function WorkItemAttachments({
  workItemId,
  list,
  locale,
  titleHidden = false,
  look,
}: {
  workItemId: string;
  list: DocumentList;
  locale: Locale;
  titleHidden?: boolean;
  look?: "chips";
}) {
  const t = useTranslations("workItems.attachments");
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { upload, open, remove, size, message, systemPending: pending } = useDocuments(workItemId, list.limits);
  const documents = list.documents.filter((d) => d.fieldKey === null && !isAnnotatedCopy(d));

  if (look === "chips") {
    return (
      <section className="space-y-3" aria-labelledby={`${inputId}-title`} data-testid="work-item-attachments">
        <h2 id={`${inputId}-title`} className="sr-only">
          {t("title")}
        </h2>
        <AttachmentChips
          labels={{
            none: t("none"),
            attach: t("add"),
            open: (document) => t("openDocument", { document }),
            remove: (document) => t("removeDocument", { document }),
          }}
          documents={documents}
          canChange={list.canChange}
          pending={pending}
          accept={list.limits.contentTypes}
          help={t("limits", { size: size(list.limits.maxBytes) })}
          onOpen={(id) => void open(id)}
          onRemove={(id) => void remove(id)}
          onAttach={(file) => void upload([file])}
        />
        {message && (
          <p role="status" className="text-sm text-muted">
            {message}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby={`${inputId}-title`} data-testid="work-item-attachments">
      <h2 id={`${inputId}-title`} className={titleHidden ? "sr-only" : "text-h6 font-semibold"}>
        {t("title")}
      </h2>
      {documents.length === 0 ? (
        <p className="text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {documents.map((d) => (
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
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload([file]).finally(() => input.current && (input.current.value = ""));
            }}
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
