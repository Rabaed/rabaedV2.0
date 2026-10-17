"use client";

import {
  checklistAnswerLabels,
  checklistAnswerSets,
  formatNumber,
  intlLocaleOf,
  isNegativeAnswer,
  type ChecklistTemplateChoice,
  type ChecklistTemplateItem,
  type Locale,
} from "@rabaed/domain";
import { Badge } from "../data/badge.tsx";
import { Select } from "../form/select.tsx";

// A Form's `checklist_template` field (RP-651; form-engine.md §3.2): the raiser picks
// one of the Project's Checklist Templates for the item's Trade, and its items are
// copied onto the item, the checklist the Consultant fills on site (RP-86). Below the
// pick, the picked Version's items are shown read-only: each check, the answers it
// takes, and what a negative answer asks for. Presentational: the page passes the
// Project's templates and the Versions the item already holds in `choices`.

/** The field's words, from the app's messages. A number is given already formatted for the locale. */
export type ChecklistTemplateFieldLabels = {
  choose: string;
  none: string;
  /** Shown in place of the choice before a Trade is chosen. */
  chooseTradeFirst: string;
  /** Shown in place of the choice when the Trade has no Checklist Template yet. */
  noneForTrade: string;
  /** A held Version no longer offered (edited or retired since), named: it stays the choice until another is picked. */
  kept: (name: string) => string;
  /** How many checks the picked template has. */
  checks: (n: string, count: number) => string;
  /** Who fills the checks in, and when. */
  filledOnSite: string;
  itemNumber: (n: string, of: string) => string;
  /** "Comment required on Fail": `answer` is the item's negative answer. */
  commentRequired: (answer: string) => string;
  photoRequired: (answer: string) => string;
  commentOptional: string;
  photoOptional: string;
  raisesSnag: (answer: string) => string;
};

/** The negative answer of an item's set, in the viewer's language: Fail or No. */
const negativeOf = (item: ChecklistTemplateItem, locale: Locale) =>
  checklistAnswerLabels[locale][checklistAnswerSets[item.answers].find(isNegativeAnswer)!];

/** A Checklist Template Version's items, read-only, numbered: each with its answers and what a negative one asks for. */
export function ChecklistTemplateItems({
  items,
  locale,
  labels: text,
}: {
  items: readonly ChecklistTemplateItem[];
  locale: Locale;
  labels: ChecklistTemplateFieldLabels;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-text">
        <span className="font-medium">{text.checks(formatNumber(items.length, locale), items.length)}</span>
        <span className="text-muted"> · {text.filledOnSite}</span>
      </p>
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => {
          const negative = negativeOf(item, locale);
          const rules = [
            item.comment === "required_on_negative" ? text.commentRequired(negative) : item.comment === "optional" ? text.commentOptional : null,
            item.photo === "required_on_negative" ? text.photoRequired(negative) : item.photo === "optional" ? text.photoOptional : null,
          ].filter((rule): rule is string => rule !== null);
          return (
            <li key={item.key} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-body font-medium text-text">
                  <bdi>{item.text[locale]}</bdi>
                </p>
                <p className="text-sm text-muted">{text.itemNumber(formatNumber(index + 1, locale), formatNumber(items.length, locale))}</p>
              </div>
              <p className="text-sm text-text-secondary">{checklistAnswerSets[item.answers].map((a) => checklistAnswerLabels[locale][a]).join(" / ")}</p>
              {(rules.length > 0 || item.on_negative === "create_snag") && (
                <div className="flex flex-wrap gap-1.5">
                  {rules.map((rule) => (
                    <Badge key={rule} tone="neutral">
                      {rule}
                    </Badge>
                  ))}
                  {item.on_negative === "create_snag" && <Badge tone="warning">{text.raisesSnag(negative)}</Badge>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type ChecklistTemplateFieldProps = {
  /** The Version picked, by id; anything else reads as none. */
  value: unknown;
  /** The item's Trade, whose templates are offered. */
  tradeId: string;
  /** The Project's templates (each one's latest Version) and the Versions the item holds. */
  choices: readonly ChecklistTemplateChoice[];
  /** The field is required: no "None" to take the pick back. */
  required: boolean;
  mode: "edit" | "read";
  locale: Locale;
  labels: ChecklistTemplateFieldLabels;
  name?: string;
  onChange?: (versionId: string | undefined) => void;
};

// A select's "no choice" item: a Version id is a uuid, so this never clashes with one.
const noChoice = "-";

/**
 * The pick: in edit mode, a select of the active templates of the Trade, and the
 * one already picked, kept while the Trade is the same; then the picked Version's
 * items. In read mode, the picked template's name and its items.
 */
export function ChecklistTemplateField({ value, tradeId, choices, required, mode, locale, labels: text, name, onChange }: ChecklistTemplateFieldProps) {
  const current = typeof value === "string" ? value : "";
  const picked = choices.find((c) => c.id === current);
  const items = picked?.items && picked.items.length > 0 ? <ChecklistTemplateItems items={picked.items} locale={locale} labels={text} /> : null;
  if (mode === "read") {
    if (!picked?.name) return null;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body font-semibold text-text">
          <bdi>{picked.name[locale]}</bdi>
        </p>
        {items}
      </div>
    );
  }

  const collator = new Intl.Collator(intlLocaleOf(locale));
  const options = choices
    .filter((c) => c.offered && c.tradeId === tradeId && c.name)
    .map((c) => ({ value: c.id, label: c.name![locale] }))
    .toSorted((a, b) => collator.compare(a.label, b.label));
  if (picked?.name && !options.some((o) => o.value === current)) options.unshift({ value: current, label: text.kept(picked.name[locale]) });
  if (options.length === 0) return <p className="text-body text-muted">{tradeId === "" ? text.chooseTradeFirst : text.noneForTrade}</p>;
  return (
    <div className="flex flex-col gap-3">
      <Select
        name={name}
        placeholder={text.choose}
        options={required ? options : [{ value: noChoice, label: text.none }, ...options]}
        value={current}
        onValueChange={(v) => onChange?.(v === noChoice ? undefined : v)}
      />
      {items}
    </div>
  );
}
