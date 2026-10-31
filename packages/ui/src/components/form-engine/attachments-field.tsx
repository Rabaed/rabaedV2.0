"use client";

import { formatNumber, type AttachmentsField as AttachmentsFieldSchema, type DocumentSummary, type Locale } from "@rabaed/domain";
import { useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Icon } from "../icon/icon.tsx";

// A Form's named `attachments` field (RP-281): its files, to open, and to upload
// and remove while the viewer may change them. Presentational: the page uploads
// (the same signed URLs as the Attachments System Field) and passes the
// field's Documents back in.

/**
 * The field's words, from the app's messages: as the Attachments System Field's,
 * a Document, never a "file" (GLOSSARY.md). A number is given already formatted
 * for the locale, with the count itself where the wording depends on it.
 */
export type AttachmentsFieldLabels = {
  none: string;
  notYet: string;
  uploading: string;
  open: (name: string) => string;
  remove: (name: string) => string;
  frozen: string;
  kb: (size: string) => string;
  mb: (size: string) => string;
  accepts: (types: string) => string;
  atMost: (n: string, count: number) => string;
  full: (n: string, count: number) => string;
};

/** A file's size in the viewer's language, with Latin digits: KB below a megabyte, else MB to one decimal. */
function fileSize(bytes: number, locale: Locale, text: AttachmentsFieldLabels): string {
  return bytes < 1024 * 1024
    ? text.kb(formatNumber(Math.max(1, Math.round(bytes / 1024)), locale))
    : text.mb(formatNumber(bytes / (1024 * 1024), locale, { maximumFractionDigits: 1 }));
}

/** A content type as people name it: `application/pdf` is PDF. */
const typeName = (contentType: string) => (contentType.split("/")[1] ?? contentType).split(/[.+-]/).pop()!.toUpperCase();

/** What a field's files are, and what may be done with them now. */
export type AttachmentsFieldFiles = {
  /** The field's confirmed Documents, in upload order. */
  documents: readonly DocumentSummary[];
  /** Files may be uploaded and removed now (the raiser's Company, in Draft, with Attach). */
  canChange: boolean;
  /** An upload or removal of this field's is under way. */
  pending?: boolean;
};

export type AttachmentsFieldProps = {
  field: AttachmentsFieldSchema;
  /** Undefined before the item exists (a new Draft): files are added once it is saved. */
  files: AttachmentsFieldFiles | undefined;
  mode: "edit" | "read";
  locale: Locale;
  labels: AttachmentsFieldLabels;
  onUpload?: (file: File) => void;
  onOpen?: (documentId: string) => void;
  onRemove?: (documentId: string) => void;
  /** "cards": the Work Item page's file cards in read mode (RP-1188, gap table row 47). */
  look?: "list" | "cards";
};

/** Whether the field shows a file input now: the files may change, and it has room for another. */
export function takesUpload(field: AttachmentsFieldSchema, files: AttachmentsFieldFiles | undefined, mode: "edit" | "read"): boolean {
  return mode === "edit" && !!files?.canChange && (field.maxFiles === undefined || files.documents.length < field.maxFiles);
}

/** The file input, wired to its Field: the Field's label names it, and its help and error describe it. */
function FileInput({ field, pending, labels, onUpload }: { field: AttachmentsFieldSchema; pending: boolean; labels: AttachmentsFieldLabels; onUpload?: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { labelId: _labelId, ...props } = useFieldControl({});
  return (
    <div className="flex flex-col gap-1">
      <input
        {...props}
        ref={input}
        type="file"
        accept={field.contentTypes?.join(",")}
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload?.(file);
          if (input.current) input.current.value = "";
        }}
        className="block w-full text-sm text-text pointer-coarse:min-h-11 file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
      />
      {pending && (
        <p role="status" className="text-sm text-muted">
          {labels.uploading}
        </p>
      )}
    </div>
  );
}

/** The field's limits, as a hint: its file types and its maximum. */
export function attachmentsLimits(field: AttachmentsFieldSchema, locale: Locale, text: AttachmentsFieldLabels): string | undefined {
  const parts = [
    field.contentTypes && text.accepts([...new Set(field.contentTypes.map(typeName))].join(", ")),
    field.maxFiles !== undefined && text.atMost(formatNumber(field.maxFiles, locale), field.maxFiles),
  ].filter((p): p is string => typeof p === "string");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function AttachmentsField({ field, files, mode, locale, labels: text, onUpload, onOpen, onRemove, look = "list" }: AttachmentsFieldProps) {
  const documents = files?.documents ?? [];
  const canRemove = mode === "edit" && !!files?.canChange;
  const upload = takesUpload(field, files, mode);
  // Without a file input, the Field's label, help and error name and describe the list as a group.
  const { labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  const group = !upload && labelId ? { role: "group", "aria-labelledby": labelId, "aria-describedby": describedBy } : {};
  if (look === "cards" && mode === "read") {
    // The Work Item page's file cards (RP-1188, gap table row 47): its type's icon on a tile, its name, its size, and a view button.
    return (
      <ul className="flex flex-col gap-2" {...group}>
        {documents.map((d) => (
          <li key={d.id} data-file-card="" className="flex items-center gap-3 rounded-[12px] bg-surface p-3 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[10px]",
                d.contentType === "application/pdf" ? "bg-danger-tint text-danger-fg" : "bg-info-tint text-info-fg",
              )}
            >
              <Icon name={d.contentType.startsWith("image/") ? "photo" : "file-text"} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold text-text">
                <bdi>{d.fileName}</bdi>
              </p>
              <p className="text-[12px] text-muted">{fileSize(d.sizeBytes, locale, text)}</p>
            </div>
            <IconButton label={text.open(d.fileName)} size="sm" onClick={() => onOpen?.(d.id)}>
              <Icon name="eye" size={18} />
            </IconButton>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-2" {...group}>
      {documents.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              <Icon name="file-text" size={20} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-text">
                  <bdi>{d.fileName}</bdi>
                </p>
                <p className="text-sm text-muted">
                  {fileSize(d.sizeBytes, locale, text)}
                  {d.frozen && mode === "edit" && ` · ${text.frozen}`}
                </p>
              </div>
              <IconButton label={text.open(d.fileName)} size="sm" onClick={() => onOpen?.(d.id)}>
                <Icon name="external-link" size={16} />
              </IconButton>
              {canRemove && !d.frozen && (
                <IconButton label={text.remove(d.fileName)} size="sm" disabled={files?.pending} onClick={() => onRemove?.(d.id)}>
                  <Icon name="trash" size={16} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      ) : (
        mode === "edit" && <p className="text-sm text-muted">{files ? text.none : text.notYet}</p>
      )}
      {upload && <FileInput field={field} pending={!!files?.pending} labels={text} onUpload={onUpload} />}
      {mode === "edit" && files?.canChange && !upload && field.maxFiles !== undefined && (
        <p className="text-sm text-muted">{text.full(formatNumber(field.maxFiles, locale), field.maxFiles)}</p>
      )}
    </div>
  );
}
