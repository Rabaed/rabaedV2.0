"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import {
  checklistAnswerLabels,
  checklistAnswerSets,
  checklistSummary,
  checklistSummaryText,
  formatNumber,
  isNegativeAnswer,
  maxChecklistComment,
  maxItemPhotos,
  snagTick,
  withAnnotatedCopies,
  type ChecklistAnswers,
  type ChecklistField as ChecklistFieldSchema,
  type ChecklistItem,
  type DocumentSummary,
  type FieldError,
  type Locale,
  type PhotosField as PhotosFieldSchema,
} from "@rabaed/domain";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Checkbox } from "../form/checkbox.tsx";
import { focusRing } from "../form/control-styles.ts";
import { OutsideField, useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import type { SaveAnnotated } from "../photo/photo-screens.tsx";
import { PhotosField, type PhotosFieldFiles, type PhotosFieldLabels } from "./photos-field.tsx";

// A Form's `checklist` field (RP-285; form-engine.md §3): the check items, each
// answered from its answer set, with the comment and photos the item asks for,
// and a summary (18 Pass / 2 Fail / 1 N/A) counted from the answers, never
// stored. A negative answer (No, Fail) is where the evidence goes: an item whose
// comment or photo is "required on negative" shows it once the answer is
// negative, and says what is missing when the item leaves Draft. Presentational:
// the page uploads photos and passes the field's Documents back in.
//
// A checklist copied from a Checklist Template (a reply Screen's, RP-86) may raise Snags (RP-577):
// an item whose template says `create_snag` shows "Raise a Snag" once answered negatively, ticked
// by default; unticking it saves `snag: false`. Read mode says whether it raises one.

/** The checklist's words, from the app's messages. A number is given already formatted for the locale. */
export type ChecklistFieldLabels = {
  comment: string;
  photos: string;
  required: string;
  notAnswered: string;
  answerThis: string;
  commentNeeded: string;
  photoNeeded: string;
  wrongType: string;
  unknownOption: string;
  tooLong: (max: string) => string;
  summary: string;
  evidence: (item: string) => string;
  itemNumber: (n: string, of: string) => string;
  /** The tick on a failed item that raises a Snag (RP-577), and what read mode says of it. */
  raiseSnag: string;
  /** Under the tick: what it does while ticked, and why one may untick it (RP-655). */
  raiseSnagTicked: string;
  raiseSnagUnticked: string;
  snagRaised: string;
  noSnagRaised: string;
  /** The links that open an optional comment or photos (RP-655). */
  addComment: string;
  addPhoto: string;
  /** An item's photos. */
  photosField: PhotosFieldLabels;
};

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
  labels: ChecklistFieldLabels;
  /** This checklist's per-item errors (`item` set), shown under their items. */
  errors?: readonly FieldError[];
  /** Undefined before the item exists (a new Draft): photos are added once it is saved. */
  files?: ChecklistFiles;
  /** Called with all the answers after a change; undefined once none is left. */
  onChange?: (value: ChecklistAnswers | undefined) => void;
  onUpload?: (itemKey: string, files: File[]) => void;
  onOpen?: (documentId: string) => void;
  onRemove?: (itemKey: string, documentId: string) => void;
  /** Stores the annotated copy of a photo, beside it in its item (PhotosField's `onSaveAnnotated`). */
  onSaveAnnotated?: SaveAnnotated;
  /** Only these items (their keys) are drawn, numbered as in the whole checklist: a filter chip's (RP-655). All by default. */
  shown?: ReadonlySet<string>;
  /** Drawn at the foot of each item's card in edit mode, e.g. whether its answer is saved (RP-655). */
  itemFooter?: (itemKey: string) => ReactNode;
  /** The summary line above the items; off where the page shows its own (the WIR's summary bar, RP-655). */
  summary?: boolean;
};

/** An item's number, as a small chip before its text. */
function ItemNumber({ n }: { n: string }) {
  return (
    <span aria-hidden="true" className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-surface-subtle px-1 text-caption font-semibold tabular-nums text-muted">
      {n}
    </span>
  );
}

const answerIcons: Record<string, IconName> = { pass: "check", yes: "check", fail: "x", no: "x", na: "minus" };

/** An answer as read: a pill coloured by what it means, Pass and Yes green, Fail and No red, N/A plain. */
function AnswerBadge({ answer, locale }: { answer: string; locale: Locale }) {
  const negative = isNegativeAnswer(answer);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold",
        answer === "na" ? "bg-neutral-tint text-neutral-fg" : negative ? "bg-danger-tint text-danger-fg" : "bg-success-tint text-success-fg",
      )}
    >
      <Icon name={answerIcons[answer] ?? "minus"} size={14} />
      {checklistAnswerLabels[locale][answer as keyof (typeof checklistAnswerLabels)["en"]]}
    </span>
  );
}

/**
 * The item's answers side by side, the width of the card and a thumb's height (RP-655): a radio
 * group, arrow keys following the reading direction. The picked one is filled, green for Pass and
 * Yes, red for Fail and No, plain for N/A.
 */
function AnswerControl({
  answers,
  value,
  locale,
  labelledBy,
  invalid,
  onValueChange,
}: {
  answers: readonly string[];
  value: string;
  locale: Locale;
  labelledBy: string;
  invalid: boolean;
  onValueChange: (answer: string) => void;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      orientation="horizontal"
      value={value}
      onValueChange={onValueChange}
      className="grid grid-cols-3 gap-1 rounded-md bg-surface-subtle p-1 aria-invalid:outline aria-invalid:outline-danger-fg"
    >
      {answers.map((answer) => {
        const negative = isNegativeAnswer(answer);
        return (
          <RadioGroupPrimitive.Item
            key={answer}
            value={answer}
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-2 rounded-sm px-2 text-body font-semibold text-text",
              "hover:bg-hover",
              // White on the filled colours in both themes (the danger button's own text colour).
              answer === "na"
                ? "data-[state=checked]:bg-surface data-[state=checked]:shadow-sm"
                : negative
                  ? "data-[state=checked]:bg-danger data-[state=checked]:text-on-danger"
                  : "data-[state=checked]:bg-success data-[state=checked]:text-on-danger",
              focusRing,
            )}
          >
            <Icon name={answerIcons[answer] ?? "minus"} size={18} />
            {checklistAnswerLabels[locale][answer as keyof (typeof checklistAnswerLabels)["en"]]}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

const answersOf = (value: unknown): ChecklistAnswers => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: ChecklistAnswers = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { answer, comment, snag } = entry as Record<string, unknown>;
    out[key] = {
      ...(typeof answer === "string" ? { answer } : {}),
      ...(typeof comment === "string" ? { comment } : {}),
      ...(snag === false ? { snag } : {}),
    };
  }
  return out;
};

/** Item `entry` with its "Raise a Snag" tick set: ticked is the default, so only unticked is kept. */
function withSnagTick(entry: ChecklistAnswers[string] | undefined, ticked: boolean): ChecklistAnswers[string] {
  const { snag: _snag, ...rest } = entry ?? {};
  return ticked ? rest : { ...rest, snag: false };
}

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

function itemErrorText(error: FieldError, locale: Locale, text: ChecklistFieldLabels): string {
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
      return text.tooLong(formatNumber(maxChecklistComment, locale));
    default:
      return text.wrongType;
  }
}

/** The derived summary: how many items were answered each way. A live region while it is being filled in. */
function Summary({ field, value, locale, text }: { field: ChecklistFieldSchema; value: unknown; locale: Locale; text: ChecklistFieldLabels }) {
  const summary = checklistSummary(field, value);
  const answered = summary.counts.some((c) => c.count > 0);
  return (
    <output
      aria-label={text.summary}
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

export function ChecklistField({
  field,
  value,
  mode,
  locale,
  labels: text,
  errors = [],
  files,
  onChange,
  onUpload,
  onOpen,
  onRemove,
  onSaveAnnotated,
  shown,
  itemFooter,
  summary = true,
}: ChecklistFieldProps) {
  const answers = answersOf(value);
  // The checklist's Field names and describes it as a group; its id is what the error summary links to.
  const { id, labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  const photosOf = (key: string) => files?.documents.filter((d) => d.itemKey === key) ?? [];
  // The optional comments and photos opened from their links ("item:comment", "item:photos").
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const open = (key: string) => setOpened((current) => new Set(current).add(key));

  const change = (key: string, entry: ChecklistAnswers[string]) => {
    const next = { ...answers };
    if (entry.answer === undefined && !entry.comment) delete next[key];
    else next[key] = entry;
    onChange?.(Object.keys(next).length > 0 ? next : undefined);
  };

  const items = field.items.map((item, index) => {
    if (shown && !shown.has(item.key)) return null;
    const entry = answers[item.key];
    const number = formatNumber(index + 1, locale);
    // The item's photos with their annotated copies; only the originals count.
    const documents = photosOf(item.key);
    const photoCount = withAnnotatedCopies(documents).length;
    const evidence = itemEvidence(item, entry, photoCount);
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
      // One row per item (RP-655): its number, its text and its answer as a badge at the end.
      const given = entry?.answer;
      const negative = given !== undefined && isNegativeAnswer(given);
      const tick = snagTick(item, entry);
      return (
        <li key={item.key} className={cn("flex flex-col gap-2 rounded-lg border bg-surface p-3", negative ? "border-danger-fg/40" : "border-border")}>
          <div className="flex items-start gap-3">
            <ItemNumber n={number} />
            <p className="min-w-0 flex-1 text-body text-text">
              <bdi>{item.text[locale]}</bdi>
            </p>
            {given === undefined ? <span className="shrink-0 text-sm text-muted">{text.notAnswered}</span> : <AnswerBadge answer={given} locale={locale} />}
          </div>
          {tick && (
            <p className="flex items-center gap-1 text-sm text-muted">
              <Icon name={tick === "ticked" ? "check" : "minus"} size={16} />
              {tick === "ticked" ? text.snagRaised : text.noSnagRaised}
            </p>
          )}
          {entry?.comment && <p className="whitespace-pre-wrap text-body text-text"><bdi>{entry.comment}</bdi></p>}
          {photoCount > 0 && (
            <PhotosField field={evidenceField(item)} files={itemFiles} mode="read" locale={locale} labels={text.photosField} label={label} onOpen={onOpen} />
          )}
        </li>
      );
    }

    const set = checklistAnswerSets[item.answers];
    const commentId = `${id ?? field.key}-${item.key}-comment`;
    const snagId = `${id ?? field.key}-${item.key}-snag`;
    const snagHelpId = `${snagId}-help`;
    const tick = snagTick(item, entry);
    const negative = entry?.answer !== undefined && isNegativeAnswer(entry.answer);
    // An optional comment or photo opens from its link; a required one, or one already given, shows open.
    const commentOpen = evidence.comment && (evidence.commentRequired || !!entry?.comment || opened.has(`${item.key}:comment`));
    const photosOpen = evidence.photos && (evidence.photosRequired || photoCount > 0 || opened.has(`${item.key}:photos`));
    const addComment = evidence.comment && !commentOpen;
    const addPhoto = evidence.photos && !photosOpen && !!files?.canChange;
    return (
      // A failed item's card is outlined red (RP-655).
      <li key={item.key} className={cn("flex flex-col gap-3 rounded-lg border bg-surface p-4", negative ? "border-danger-fg/60" : "border-border")}>
        <div className="flex items-start gap-3">
          <ItemNumber n={number} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p id={textId} className="text-body font-medium text-text">
              <bdi>{item.text[locale]}</bdi>
            </p>
            <p className="sr-only">{text.itemNumber(number, formatNumber(field.items.length, locale))}</p>
          </div>
        </div>
        <OutsideField>
          <AnswerControl
            answers={set}
            value={entry?.answer ?? ""}
            locale={locale}
            labelledBy={textId}
            invalid={itemErrors.some((e) => e.code === "required" || e.code === "unknown_option" || e.code === "wrong_type")}
            onValueChange={(answer) => change(item.key, { ...entry, answer })}
          />
          {(addComment || addPhoto) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {addComment && (
                <button type="button" onClick={() => open(`${item.key}:comment`)} className={cn("inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-text md:min-h-0", focusRing)}>
                  <Icon name="message-circle" size={16} />
                  {text.addComment}
                </button>
              )}
              {addPhoto && (
                <button type="button" onClick={() => open(`${item.key}:photos`)} className={cn("inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-text md:min-h-0", focusRing)}>
                  <Icon name="camera" size={16} />
                  {text.addPhoto}
                </button>
              )}
            </div>
          )}
          {commentOpen && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={commentId} className="text-sm font-medium text-text">
                {text.comment}
                {evidence.commentRequired && <span className="font-semibold text-danger-fg"> ({text.required})</span>}
              </label>
              <Textarea
                id={commentId}
                rows={3}
                dir="auto"
                maxLength={maxChecklistComment}
                required={evidence.commentRequired}
                aria-invalid={itemErrors.some((e) => e.code === "comment_required" || e.code === "too_long") || undefined}
                value={entry?.comment ?? ""}
                onChange={(event) => change(item.key, { ...entry, comment: event.target.value })}
              />
            </div>
          )}
          {photosOpen && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-text">
                {text.photos}
                {evidence.photosRequired && <span className="font-semibold text-danger-fg"> ({text.required})</span>}
              </p>
              <PhotosField
                field={evidenceField(item)}
                files={itemFiles}
                mode="edit"
                locale={locale}
                labels={text.photosField}
                label={label}
                onUpload={(picked) => onUpload?.(item.key, picked)}
                onOpen={onOpen}
                onRemove={(documentId) => onRemove?.(item.key, documentId)}
                onSaveAnnotated={onSaveAnnotated}
              />
            </div>
          )}
          {/* The "Raise a Snag" tick in its own panel, tinted while ticked (RP-577, RP-655). */}
          {tick && (
            <div className={cn("flex items-start gap-3 rounded-md p-3", tick === "ticked" ? "bg-danger-tint" : "bg-surface-subtle")}>
              <Checkbox
                id={snagId}
                aria-describedby={snagHelpId}
                checked={tick === "ticked"}
                onCheckedChange={(checked) => change(item.key, withSnagTick(entry, checked === true))}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <label htmlFor={snagId} className={cn("text-body font-semibold", tick === "ticked" ? "text-danger-fg" : "text-text")}>
                  {text.raiseSnag}
                </label>
                <p id={snagHelpId} className="text-sm text-muted">
                  {tick === "ticked" ? text.raiseSnagTicked : text.raiseSnagUnticked}
                </p>
              </div>
            </div>
          )}
        </OutsideField>
        {itemErrors.length > 0 && (
          <ul className="flex flex-col gap-1">
            {itemErrors.map((error) => (
              <li key={error.code} className="flex items-start gap-1 text-sm text-danger-fg">
                <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
                <span>{itemErrorText(error, locale, text)}</span>
              </li>
            ))}
          </ul>
        )}
        {itemFooter?.(item.key)}
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
      {summary && <Summary field={field} value={answers} locale={locale} text={text} />}
      <ol className="flex flex-col gap-3">{items}</ol>
    </div>
  );
}
