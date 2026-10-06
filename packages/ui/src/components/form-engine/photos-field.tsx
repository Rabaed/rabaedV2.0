"use client";

import {
  fileFieldContentTypes,
  formatDate,
  formatNumber,
  type DocumentSummary,
  type Locale,
  type PhotosField as PhotosFieldSchema,
  type TakenWhere,
} from "@rabaed/domain";
import { useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants, IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { OutsideField, useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Icon } from "../icon/icon.tsx";
import type { AttachmentsFieldFiles } from "./attachments-field.tsx";

// A Form's `photos` field (RP-284): its photos as thumbnails, each with when and
// where it was taken (from its EXIF, read by the api; visibility.md V13), to
// open full size; and, while the viewer may change them, photos to take with
// the phone's camera or choose, several at once, and to remove. Presentational:
// the page uploads and passes the field's Documents, and their image URLs, back in.

const copy = {
  en: {
    none: "No photos yet.",
    notYet: "Photos can be added once the Draft is saved.",
    uploading: "Uploading…",
    takePhoto: "Take a photo",
    open: (name: string) => `Open ${name} full size`,
    remove: (name: string) => `Remove ${name}`,
    frozen: "Sent: can't be changed",
    taken: (when: string) => `Taken ${when}`,
    nothingRecorded: "No time/location recorded",
    noTime: "No time recorded",
    noPlace: "No location recorded",
    atMost: (n: number) => (n === 1 ? "At most 1 photo" : `At most ${formatNumber(n, "en")} photos`),
    full: (n: number) => (n === 1 ? "This field takes 1 photo." : `This field takes at most ${formatNumber(n, "en")} photos.`),
  },
  ar: {
    none: "لا توجد صور بعد.",
    notYet: "يمكن إضافة الصور بعد حفظ المسودة.",
    uploading: "جارٍ الرفع…",
    takePhoto: "التقط صورة",
    open: (name: string) => `فتح \u2068${name}\u2069 بالحجم الكامل`,
    remove: (name: string) => `إزالة \u2068${name}\u2069`,
    frozen: "مُرسَل: لا يمكن تغييره",
    taken: (when: string) => `التُقطت ${when}`,
    nothingRecorded: "لم يُسجَّل وقت أو موقع",
    noTime: "لم يُسجَّل وقت",
    noPlace: "لم يُسجَّل موقع",
    // Arabic counts: one, two (dual), 3–10 (plural), 11 and more (singular accusative).
    atMost: (n: number) =>
      n === 1
        ? "صورة واحدة على الأكثر"
        : n === 2
          ? "صورتان على الأكثر"
          : n <= 10
            ? `${formatNumber(n, "ar")} صور على الأكثر`
            : `${formatNumber(n, "ar")} صورة على الأكثر`,
    full: (n: number) =>
      n === 1
        ? "يقبل هذا الحقل صورة واحدة."
        : n === 2
          ? "يقبل هذا الحقل صورتين على الأكثر."
          : n <= 10
            ? `يقبل هذا الحقل ${formatNumber(n, "ar")} صور على الأكثر.`
            : `يقبل هذا الحقل ${formatNumber(n, "ar")} صورة على الأكثر.`,
  },
} satisfies Record<Locale, unknown>;

/** What a photos field's files are, what may be done with them now, and their images to show. */
export type PhotosFieldFiles = AttachmentsFieldFiles & {
  /** Each photo's image URL, by Document id; a photo without one shows an icon in its place. */
  imageUrls?: Readonly<Record<string, string>>;
};

export type PhotosFieldProps = {
  field: PhotosFieldSchema;
  /** Undefined before the item exists (a new Draft): photos are added once it is saved. */
  files: PhotosFieldFiles | undefined;
  mode: "edit" | "read";
  locale: Locale;
  /**
   * What names these photos when the field is not in a Field of its own (a
   * checklist item's evidence): its accessible name, in the viewer's language.
   */
  label?: string;
  /** Called with the photos taken or chosen, in order. */
  onUpload?: (files: File[]) => void;
  onOpen?: (documentId: string) => void;
  onRemove?: (documentId: string) => void;
};

/** Whether the field takes photos now: they may change, and it has room for another. */
export function takesPhotos(field: PhotosFieldSchema, files: PhotosFieldFiles | undefined, mode: "edit" | "read"): boolean {
  return mode === "edit" && !!files?.canChange && (field.maxFiles === undefined || files.documents.length < field.maxFiles);
}

/** The field's limit, as a hint: its maximum of photos. */
export function photosLimits(field: PhotosFieldSchema, locale: Locale): string | undefined {
  return field.maxFiles === undefined ? undefined : copy[locale].atMost(field.maxFiles);
}

/** Where a photo was taken, as degrees north or south and east or west: Latin, left to right, in either language. */
export function placeText({ latitude, longitude }: TakenWhere): string {
  const degrees = (value: number) => formatNumber(Math.abs(value), "en", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  return `${degrees(latitude)}° ${latitude < 0 ? "S" : "N"}, ${degrees(longitude)}° ${longitude < 0 ? "W" : "E"}`;
}

/** When and where a photo was taken, or that it records neither. */
function TakenLine({ document, locale }: { document: DocumentSummary; locale: Locale }) {
  const text = copy[locale];
  const { takenAt, takenWhere } = document;
  if (!takenAt && !takenWhere) return <p className="text-sm text-muted">{text.nothingRecorded}</p>;
  return (
    <>
      <p className="flex items-start gap-1 text-sm text-text">
        <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-muted" />
        {takenAt ? (
          text.taken(formatDate(new Date(takenAt), locale, { dateStyle: "medium", timeStyle: "short" }))
        ) : (
          <span className="text-muted">{text.noTime}</span>
        )}
      </p>
      <p className="flex items-start gap-1 text-sm text-text">
        <Icon name="map-pin" size={16} className="mt-0.5 shrink-0 text-muted" />
        {takenWhere ? (
          <bdi dir="ltr" className="tabular-nums">
            {placeText(takenWhere)}
          </bdi>
        ) : (
          <span className="text-muted">{text.noPlace}</span>
        )}
      </p>
    </>
  );
}

/** The inputs that add photos: the Field's own (choose, several at once) and the camera's. */
function PhotoInputs({
  field,
  pending,
  locale,
  label,
  onUpload,
}: {
  field: PhotosFieldSchema;
  pending: boolean;
  locale: Locale;
  label?: string;
  onUpload?: (files: File[]) => void;
}) {
  const choose = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const { labelId: _labelId, ...props } = useFieldControl({});
  const accept = fileFieldContentTypes(field)?.join(",");
  const picked = (input: HTMLInputElement | null) => {
    const files = [...(input?.files ?? [])];
    if (files.length > 0) onUpload?.(files);
    if (input) input.value = "";
  };
  return (
    <div className="flex flex-col gap-2">
      <input
        {...props}
        ref={choose}
        type="file"
        multiple
        accept={accept}
        aria-label={label}
        disabled={pending}
        onChange={() => picked(choose.current)}
        className="block w-full text-sm text-text file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
      />
      {/* On a phone, straight to the back camera; elsewhere it chooses a file, as the input above. */}
      <OutsideField>
        <label
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "w-full cursor-pointer sm:w-fit",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            pending && "pointer-events-none opacity-50",
          )}
        >
          <Icon name="camera" size={20} />
          {copy[locale].takePhoto}
          <input
            ref={camera}
            type="file"
            accept={accept}
            capture="environment"
            aria-label={label && `${copy[locale].takePhoto}: ${label}`}
            disabled={pending}
            onChange={() => picked(camera.current)}
            className="sr-only"
          />
        </label>
      </OutsideField>
      {pending && (
        <p role="status" className="text-sm text-muted">
          {copy[locale].uploading}
        </p>
      )}
    </div>
  );
}

export function PhotosField({ field, files, mode, locale, label, onUpload, onOpen, onRemove }: PhotosFieldProps) {
  const text = copy[locale];
  const documents = files?.documents ?? [];
  const canRemove = mode === "edit" && !!files?.canChange;
  const upload = takesPhotos(field, files, mode);
  // Without a file input, the Field's label, help and error name and describe the photos as a group.
  const { labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  const group = label
    ? { role: "group", "aria-label": label }
    : !upload && labelId
      ? { role: "group", "aria-labelledby": labelId, "aria-describedby": describedBy }
      : {};
  return (
    <div className="flex flex-col gap-3" {...group}>
      {documents.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {documents.map((d) => {
            const url = files?.imageUrls?.[d.id];
            return (
              <li key={d.id} className="flex min-w-0 flex-col gap-1">
                <div className="relative">
                  <button
                    type="button"
                    aria-label={text.open(d.fileName)}
                    onClick={() => onOpen?.(d.id)}
                    className={cn(
                      "flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface-subtle",
                      focusRing,
                    )}
                  >
                    {url ? (
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="photo" size={32} className="text-muted" />
                    )}
                  </button>
                  {canRemove && !d.frozen && (
                    <IconButton
                      label={text.remove(d.fileName)}
                      size="sm"
                      variant="secondary"
                      disabled={files?.pending}
                      onClick={() => onRemove?.(d.id)}
                      className="absolute end-1 top-1"
                    >
                      <Icon name="trash" size={16} />
                    </IconButton>
                  )}
                </div>
                <TakenLine document={d} locale={locale} />
                {d.frozen && mode === "edit" && <p className="text-sm text-muted">{text.frozen}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        mode === "edit" && <p className="text-sm text-muted">{files ? text.none : text.notYet}</p>
      )}
      {upload && <PhotoInputs field={field} pending={!!files?.pending} locale={locale} label={label} onUpload={onUpload} />}
      {mode === "edit" && files?.canChange && !upload && field.maxFiles !== undefined && (
        <p className="text-sm text-muted">{text.full(field.maxFiles)}</p>
      )}
    </div>
  );
}
