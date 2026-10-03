"use client";

import { formatNumber, type AttachmentsField as AttachmentsFieldSchema, type DocumentSummary, type Locale } from "@rabaed/domain";
import { useRef } from "react";
import { IconButton } from "../button/button.tsx";
import { useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Icon } from "../icon/icon.tsx";

// A Form's named `attachments` field (RP-281): its files, to open, and to upload
// and remove while the viewer may change them. Presentational: the page uploads
// (the same signed URLs as the Attachments System Field) and passes the
// field's Documents back in.

// Words as the Attachments System Field's (the web app's messages): a Document, never a "file" (CONTEXT.md).
const copy = {
  en: {
    none: "No Documents yet.",
    notYet: "Documents can be added once the Draft is saved.",
    uploading: "Uploading…",
    open: (name: string) => `Open ${name}`,
    remove: (name: string) => `Remove ${name}`,
    frozen: "Sent: can't be changed",
    kb: (size: string) => `${size} KB`,
    mb: (size: string) => `${size} MB`,
    accepts: (types: string) => `${types} only`,
    atMost: (n: number) => (n === 1 ? "At most 1 Document" : `At most ${formatNumber(n, "en")} Documents`),
    full: (n: number) => (n === 1 ? "This field takes 1 Document." : `This field takes at most ${formatNumber(n, "en")} Documents.`),
  },
  ar: {
    none: "لا توجد مستندات بعد.",
    notYet: "يمكن إضافة المستندات بعد حفظ المسودة.",
    uploading: "جارٍ الرفع…",
    open: (name: string) => `فتح \u2068${name}\u2069`,
    remove: (name: string) => `إزالة \u2068${name}\u2069`,
    frozen: "مُرسَل: لا يمكن تغييره",
    kb: (size: string) => `${size} ك.ب`,
    mb: (size: string) => `${size} م.ب`,
    // Latin file types sit in an isolate (\u2066 left to right, \u2069 ends).
    accepts: (types: string) => `\u2066${types}\u2069 فقط`,
    // Arabic counts: one, two (dual), 3–10 (plural), 11 and more (singular accusative).
    atMost: (n: number) =>
      n === 1
        ? "مستند واحد على الأكثر"
        : n === 2
          ? "مستندان على الأكثر"
          : n <= 10
            ? `${formatNumber(n, "ar")} مستندات على الأكثر`
            : `${formatNumber(n, "ar")} مستندًا على الأكثر`,
    full: (n: number) =>
      n === 1
        ? "يقبل هذا الحقل مستندًا واحدًا."
        : n === 2
          ? "يقبل هذا الحقل مستندين على الأكثر."
          : n <= 10
            ? `يقبل هذا الحقل ${formatNumber(n, "ar")} مستندات على الأكثر.`
            : `يقبل هذا الحقل ${formatNumber(n, "ar")} مستندًا على الأكثر.`,
  },
} satisfies Record<Locale, unknown>;

/** A file's size in the viewer's language, with Latin digits: KB below a megabyte, else MB to one decimal. */
function fileSize(bytes: number, locale: Locale): string {
  const text = copy[locale];
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
  onUpload?: (file: File) => void;
  onOpen?: (documentId: string) => void;
  onRemove?: (documentId: string) => void;
};

/** Whether the field shows a file input now: the files may change, and it has room for another. */
export function takesUpload(field: AttachmentsFieldSchema, files: AttachmentsFieldFiles | undefined, mode: "edit" | "read"): boolean {
  return mode === "edit" && !!files?.canChange && (field.maxFiles === undefined || files.documents.length < field.maxFiles);
}

/** The file input, wired to its Field: the Field's label names it, and its help and error describe it. */
function FileInput({ field, pending, locale, onUpload }: { field: AttachmentsFieldSchema; pending: boolean; locale: Locale; onUpload?: (file: File) => void }) {
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
        className="block w-full text-sm text-text file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
      />
      {pending && (
        <p role="status" className="text-sm text-muted">
          {copy[locale].uploading}
        </p>
      )}
    </div>
  );
}

/** The field's limits, as a hint: its file types and its maximum. */
export function attachmentsLimits(field: AttachmentsFieldSchema, locale: Locale): string | undefined {
  const text = copy[locale];
  const parts = [
    field.contentTypes && text.accepts([...new Set(field.contentTypes.map(typeName))].join(", ")),
    field.maxFiles !== undefined && text.atMost(field.maxFiles),
  ].filter((p): p is string => typeof p === "string");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function AttachmentsField({ field, files, mode, locale, onUpload, onOpen, onRemove }: AttachmentsFieldProps) {
  const text = copy[locale];
  const documents = files?.documents ?? [];
  const canRemove = mode === "edit" && !!files?.canChange;
  const upload = takesUpload(field, files, mode);
  // Without a file input, the Field's label, help and error name and describe the list as a group.
  const { labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  const group = !upload && labelId ? { role: "group", "aria-labelledby": labelId, "aria-describedby": describedBy } : {};
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
                  {fileSize(d.sizeBytes, locale)}
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
      {upload && <FileInput field={field} pending={!!files?.pending} locale={locale} onUpload={onUpload} />}
      {mode === "edit" && files?.canChange && !upload && field.maxFiles !== undefined && (
        <p className="text-sm text-muted">{text.full(field.maxFiles)}</p>
      )}
    </div>
  );
}
