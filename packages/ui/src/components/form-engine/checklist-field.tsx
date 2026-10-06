"use client";

import {
  checklistAnswerLabels,
  checklistAnswerSets,
  checklistSummary,
  checklistSummaryText,
  formatNumber,
  isNegativeAnswer,
  maxChecklistComment,
  maxItemPhotos,
  type ChecklistAnswers,
  type ChecklistField as ChecklistFieldSchema,
  type ChecklistItem,
  type DocumentSummary,
  type FieldError,
  type Locale,
  type PhotosField as PhotosFieldSchema,
} from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { OutsideField, useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { PhotosField, type PhotosFieldFiles } from "./photos-field.tsx";

// A Form's `checklist` field (RP-285; form-engine.md §3): the check items, each
// answered from its answer set, with the comment and photos the item asks for,
// and a summary (18 Pass / 2 Fail / 1 N/A) counted from the answers, never
// stored. A negative answer (No, Fail) is where the evidence goes: an item whose
// comment or photo is "required on negative" shows it once the answer is
// negative, and says what is missing when the item leaves Draft. Presentational:
// the page uploads photos and passes the field's Documents back in.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: {
    comment: "Comment",
    photos: "Photos",
    required: "required",
    notAnswered: "Not answered",
    answerThis: "Answer this item.",
    commentNeeded: "Add a comment to explain this answer.",
    photoNeeded: "Add a photo as evidence for this answer.",
    wrongType: "This value isn't valid here.",
    unknownOption: "Choose one of the answers.",
    tooLong: (max: number) => `Use at most ${formatNumber(max, "en")} characters.`,
    summary: "Summary",
    evidence: (item: string) => `Photos for ${item}`,
    itemNumber: (n: number, of: number) => `${formatNumber(n, "en")} of ${formatNumber(of, "en")}`,
  },
  ar: {
    comment: "التعليق",
    photos: "الصور",
    required: "مطلوب",
    notAnswered: "لم تتم الإجابة",
    answerThis: "أجب عن هذا البند.",
    commentNeeded: "أضف تعليقًا يوضح هذه الإجابة.",
    photoNeeded: "أضف صورة كدليل لهذه الإجابة.",
    wrongType: "هذه القيمة غير صالحة هنا.",
    unknownOption: "اختر إحدى الإجابات.",
    tooLong: (max: number) => `استخدم ${formatNumber(max, "ar")} حرفًا على الأكثر.`,
    summary: "الملخص",
    evidence: (item: string) => `صور \u2068${item}\u2069`,
    itemNumber: (n: number, of: number) => `${formatNumber(n, "ar")} من ${formatNumber(of, "ar")}`,
  },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

/** What a checklist's photos are, and what may be done with them now: the field's Documents, whichever items they are evidence for. */
export type ChecklistFiles = Omit<PhotosFieldFiles, "documents" | "pending"> & {
  /** The item's confirmed Documents tied to this checklist (`itemKey` says which item); others are ignored. */
  documents: readonly DocumentSummary[];
  /** The checklist items (their keys) with an upload or removal under way. */
  pendingItems?: ReadonlySet<string>;
};

export type ChecklistFieldProps = {
  field: ChecklistFieldSchema;
  /** The saved or typed answers: item key → answer and comment. Anything else reads as none. */
  value: unknown;
  mode: "edit" | "read";
  locale: Locale;
  /** This checklist's per-item errors (`item` set), shown under their items. */
  errors?: readonly FieldError[];
  /** Undefined before the item exists (a new Draft): photos are added once it is saved. */
  files?: ChecklistFiles;
  /** Called with all the answers after a change; undefined once none is left. */
  onChange?: (value: ChecklistAnswers | undefined) => void;
  onUpload?: (itemKey: string, files: File[]) => void;
  onOpen?: (documentId: string) => void;
  onRemove?: (itemKey: string, documentId: string) => void;
};

const answersOf = (value: unknown): ChecklistAnswers => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: ChecklistAnswers = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { answer, comment } = entry as Record<string, unknown>;
    out[key] = {
      ...(typeof answer === "string" ? { answer } : {}),
      ...(typeof comment === "string" ? { comment } : {}),
    };
  }
  return out;
};

/** What an item shows beside its answer: the comment and the photos it takes (an item that requires them on a negative answer takes them then, or when it holds some). */
export function itemEvidence(item: ChecklistItem, entry: ChecklistAnswers[string] | undefined, photos: number) {
  const negative = entry?.answer !== undefined && isNegativeAnswer(entry.answer);
  const takes = (rule: ChecklistItem["comment"], has: boolean) => rule === "optional" || (rule === "required_on_negative" && (negative || has));
  return {
    comment: takes(item.comment, !!entry?.comment),
    photos: takes(item.photo, photos > 0),
    commentRequired: item.comment === "required_on_negative" && negative,
    photosRequired: item.photo === "required_on_negative" && negative,
  };
}

function itemErrorText(error: FieldError, locale: Locale): string {
  const text = copy[locale];
  switch (error.code) {
    case "required":
      return text.answerThis;
    case "comment_required":
      return text.commentNeeded;
    case "photo_required":
      return text.photoNeeded;
    case "unknown_option":
      return text.unknownOption;
    case "too_long":
      return text.tooLong(maxChecklistComment);
    default:
      return text.wrongType;
  }
}

/** The derived summary: how many items were answered each way. A live region while it is being filled in. */
function Summary({ field, value, locale }: { field: ChecklistFieldSchema; value: unknown; locale: Locale }) {
  const summary = checklistSummary(field, value);
  const answered = summary.counts.some((c) => c.count > 0);
  return (
    <output
      aria-label={copy[locale].summary}
      className={cn("flex flex-wrap items-center gap-x-2 text-body font-medium", answered ? "text-text" : "text-muted")}
    >
      <bdi>{checklistSummaryText(summary, locale)}</bdi>
    </output>
  );
}

/** The photo field an item's evidence is shown with: the item's key, up to the most an item takes. */
const evidenceField = (item: ChecklistItem): PhotosFieldSchema => ({
  key: item.key,
  type: "photos",
  label: item.text,
  required: false,
  maxFiles: maxItemPhotos,
});

export function ChecklistField({ field, value, mode, locale, errors = [], files, onChange, onUpload, onOpen, onRemove }: ChecklistFieldProps) {
  const text = copy[locale];
  const answers = answersOf(value);
  // The checklist's Field names and describes it as a group; its id is what the error summary links to.
  const { id, labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  const photosOf = (key: string) => files?.documents.filter((d) => d.itemKey === key) ?? [];

  const change = (key: string, entry: ChecklistAnswers[string]) => {
    const next = { ...answers };
    if (entry.answer === undefined && !entry.comment) delete next[key];
    else next[key] = entry;
    onChange?.(Object.keys(next).length > 0 ? next : undefined);
  };

  const items = field.items.map((item, index) => {
    const entry = answers[item.key];
    const documents = photosOf(item.key);
    const shown = itemEvidence(item, entry, documents.length);
    const textId = `${id ?? field.key}-${item.key}-text`;
    const itemErrors = errors.filter((e) => e.item === item.key);
    const label = text.evidence(item.text[locale]);
    const itemFiles: PhotosFieldFiles | undefined = files && {
      documents,
      canChange: files.canChange,
      pending: files.pendingItems?.has(item.key),
      imageUrls: files.imageUrls,
    };

    if (mode === "read") {
      const given = entry?.answer;
      if (given === undefined && !entry?.comment && documents.length === 0) {
        return (
          <li key={item.key} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <p className="text-body text-text"><bdi>{item.text[locale]}</bdi></p>
            <p className="text-sm text-muted">{text.notAnswered}</p>
          </li>
        );
      }
      const negative = given !== undefined && isNegativeAnswer(given);
      return (
        <li key={item.key} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-body text-text"><bdi>{item.text[locale]}</bdi></p>
          <p className={cn("flex items-center gap-1 text-body font-semibold", negative ? "text-danger" : "text-text")}>
            {negative && <Icon name="alert-circle" size={16} />}
            {given === undefined ? (
              <span className="font-normal text-muted">{text.notAnswered}</span>
            ) : (
              checklistAnswerLabels[locale][given as keyof (typeof checklistAnswerLabels)["en"]]
            )}
          </p>
          {entry?.comment && <p className="whitespace-pre-wrap text-body text-text"><bdi>{entry.comment}</bdi></p>}
          {documents.length > 0 && (
            <PhotosField field={evidenceField(item)} files={itemFiles} mode="read" locale={locale} label={label} onOpen={onOpen} />
          )}
        </li>
      );
    }

    const set = checklistAnswerSets[item.answers];
    const commentId = `${id ?? field.key}-${item.key}-comment`;
    return (
      <li key={item.key} className="flex flex-col gap-3 rounded-md border border-border p-3">
        <div className="flex flex-col gap-0.5">
          <p id={textId} className="text-body font-medium text-text"><bdi>{item.text[locale]}</bdi></p>
          <p className="text-sm text-muted">{text.itemNumber(index + 1, field.items.length)}</p>
        </div>
        <OutsideField>
          <SegmentedControl
            aria-labelledby={textId}
            aria-invalid={itemErrors.some((e) => e.code === "required" || e.code === "unknown_option" || e.code === "wrong_type") || undefined}
            options={set.map((answer) => ({ value: answer, label: checklistAnswerLabels[locale][answer] }))}
            value={entry?.answer ?? ""}
            onValueChange={(answer) => change(item.key, { ...entry, answer })}
          />
          {shown.comment && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={commentId} className="text-sm font-medium text-text">
                {text.comment}
                {shown.commentRequired && <span className="text-muted"> ({text.required})</span>}
              </label>
              <Textarea
                id={commentId}
                rows={3}
                dir="auto"
                maxLength={maxChecklistComment}
                required={shown.commentRequired}
                aria-invalid={itemErrors.some((e) => e.code === "comment_required" || e.code === "too_long") || undefined}
                value={entry?.comment ?? ""}
                onChange={(event) => change(item.key, { ...entry, comment: event.target.value })}
              />
            </div>
          )}
          {shown.photos && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-text">
                {text.photos}
                {shown.photosRequired && <span className="text-muted"> ({text.required})</span>}
              </p>
              <PhotosField
                field={evidenceField(item)}
                files={itemFiles}
                mode="edit"
                locale={locale}
                label={label}
                onUpload={(picked) => onUpload?.(item.key, picked)}
                onOpen={onOpen}
                onRemove={(documentId) => onRemove?.(item.key, documentId)}
              />
            </div>
          )}
        </OutsideField>
        {itemErrors.length > 0 && (
          <ul className="flex flex-col gap-1">
            {itemErrors.map((error) => (
              <li key={error.code} className="flex items-start gap-1 text-sm text-danger">
                <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
                <span>{itemErrorText(error, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  });

  return (
    <div
      id={id}
      // The error summary links here: focusable by script, never by Tab.
      tabIndex={-1}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      className="flex flex-col gap-3 focus:outline-none"
    >
      <Summary field={field} value={answers} locale={locale} />
      <ol className="flex flex-col gap-3">{items}</ol>
    </div>
  );
}
