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
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { Select } from "../form/select.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

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
  /** The cards' line (RP-655): "Templates for Civil". */
  forTrade: (trade: string) => string;
  /** "· 1 for other Trades hidden": the active templates of other Trades, not offered. */
  otherTradesHidden: (n: string, count: number) => string;
  /** A Version's number: "v3". */
  version: (n: string) => string;
  /** Under the cards: when the pick stops changing. */
  locked: string;
  hideItems: string;
  showItems: string;
  /**
   * The preview's notice: on a negative `answer` the Consultant must add a comment, a photo or
   * both; `every`: every item asks it, else some do.
   */
  negativeAsks: (answer: string, what: "comment" | "photo" | "both", every: boolean) => string;
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
  /** How the pick shows in edit mode: a select (default), or radio cards with their preview (RP-655, the WIR request). */
  look?: "select" | "cards";
  /** The Trade's name, which the cards' line names. */
  tradeName?: string;
};

// A select's "no choice" item: a Version id is a uuid, so this never clashes with one.
const noChoice = "-";

/**
 * What the select offers: the active templates of the Trade, sorted in the viewer's
 * alphabet, and first the one already picked when it isn't one of them any more. None
 * means there is no select, only a line saying why.
 */
export function templateOptions(
  value: unknown,
  tradeId: string,
  choices: readonly ChecklistTemplateChoice[],
  locale: Locale,
  text: ChecklistTemplateFieldLabels,
): { value: string; label: string }[] {
  const current = typeof value === "string" ? value : "";
  const picked = choices.find((c) => c.id === current);
  const collator = new Intl.Collator(intlLocaleOf(locale));
  const options = choices
    .filter((c) => c.offered && c.tradeId === tradeId && c.name)
    .map((c) => ({ value: c.id, label: c.name![locale] }))
    .toSorted((a, b) => collator.compare(a.label, b.label));
  if (picked?.name && !options.some((o) => o.value === current)) options.unshift({ value: current, label: text.kept(picked.name[locale]) });
  return options;
}

/** "v3 · 24 items": a template's Version, where known, and how many checks it has. */
export function templateMeta(choice: ChecklistTemplateChoice, locale: Locale, text: ChecklistTemplateFieldLabels): string {
  const count = choice.items?.length ?? 0;
  const checks = text.checks(formatNumber(count, locale), count);
  return choice.versionNo === undefined ? checks : `${text.version(formatNumber(choice.versionNo, locale))} · ${checks}`;
}

/** What a negative answer asks of the Consultant across the items, for the preview's notice; null when nothing. */
function negativeAsks(items: readonly ChecklistTemplateItem[], locale: Locale, text: ChecklistTemplateFieldLabels): string | null {
  const comment = items.filter((i) => i.comment === "required_on_negative");
  const photo = items.filter((i) => i.photo === "required_on_negative");
  const asking = items.filter((i) => comment.includes(i) || photo.includes(i));
  if (asking.length === 0) return null;
  const what = comment.length > 0 && photo.length > 0 ? "both" : comment.length > 0 ? "comment" : "photo";
  const every = what === "both" ? comment.length === items.length && photo.length === items.length : asking.length === items.length;
  return text.negativeAsks(negativeOf(asking[0]!, locale), what, every);
}

/**
 * A picked template at a glance (RP-655, the WIR request's "Template preview"): its name, Version
 * and count, what a negative answer asks of the Consultant, and its checks numbered, text only.
 */
export function ChecklistTemplatePreview({ choice, locale, labels: text }: { choice: ChecklistTemplateChoice; locale: Locale; labels: ChecklistTemplateFieldLabels }) {
  const items = choice.items ?? [];
  const notice = negativeAsks(items, locale, text);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body font-semibold text-text">{choice.name && <bdi>{choice.name[locale]}</bdi>}</h3>
        <p className="text-sm text-muted">{templateMeta(choice, locale, text)}</p>
      </div>
      {notice && (
        <p className="flex items-start gap-2 rounded-md bg-warning-tint p-3 text-sm text-warning-fg">
          <Icon name="info-circle" size={16} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
      <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm text-text">
        {items.map((item) => (
          <li key={item.key}>
            <bdi>{item.text[locale]}</bdi>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The pick as radio cards (RP-655, the WIR request): one card per active template of the Trade,
 * with its Version and count, the line naming the Trade and how many other Trades' are hidden, and
 * when the pick locks. On a phone the picked one's preview follows, which Hide items folds; a wide
 * screen leaves it to the page, which shows it beside the Form.
 */
function TemplateCards({
  value,
  tradeId,
  tradeName,
  choices,
  required,
  locale,
  labels: text,
  name,
  onChange,
}: Omit<ChecklistTemplateFieldProps, "mode" | "look">) {
  const [itemsShown, setItemsShown] = useState(true);
  const current = typeof value === "string" ? value : "";
  const options = templateOptions(value, tradeId, choices, locale, text);
  const hidden = choices.filter((c) => c.offered && c.name && c.tradeId !== tradeId).length;
  const picked = choices.find((c) => c.id === current && c.name);
  const cards = required ? options : [{ value: noChoice, label: text.none }, ...options];
  return (
    <div className="flex flex-col gap-3">
      {tradeName && (
        <p className="text-sm text-muted">
          {text.forTrade(tradeName)}
          {hidden > 0 && ` · ${text.otherTradesHidden(formatNumber(hidden, locale), hidden)}`}
        </p>
      )}
      <div role="radiogroup" aria-label={tradeName ? text.forTrade(tradeName) : undefined} className="flex flex-col gap-2">
        {cards.map((o) => {
          const choice = choices.find((c) => c.id === o.value);
          const checked = o.value === noChoice ? current === "" : o.value === current;
          return (
            <label
              key={o.value}
              className={cn(
                "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3",
                checked ? "border-brand bg-brand-tint" : "border-border bg-surface hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange?.(o.value === noChoice ? undefined : o.value)}
                className={cn("mt-1 size-4 shrink-0 accent-brand", focusRing)}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body font-semibold text-text">
                  <bdi>{o.label}</bdi>
                </span>
                {choice && <span className="text-sm text-muted">{templateMeta(choice, locale, text)}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <p className="flex items-start gap-2 text-sm text-muted">
        <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
        {text.locked}
      </p>
      {picked && (
        <div className="flex flex-col gap-3 lg:hidden">
          <button
            type="button"
            aria-expanded={itemsShown}
            onClick={() => setItemsShown(!itemsShown)}
            className={cn("flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-text", focusRing)}
          >
            <Icon name={itemsShown ? "eye-off" : "eye"} size={16} />
            {itemsShown ? text.hideItems : text.showItems}
          </button>
          {itemsShown && (
            <div className="rounded-lg bg-surface-subtle p-3">
              <ChecklistTemplatePreview choice={picked} locale={locale} labels={text} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The picked Version's items, read-only, or null when nothing (or nothing known) is picked. */
export function PickedTemplateItems({ value, choices, locale, labels }: { value: unknown; choices: readonly ChecklistTemplateChoice[]; locale: Locale; labels: ChecklistTemplateFieldLabels }) {
  const picked = typeof value === "string" ? choices.find((c) => c.id === value) : undefined;
  return picked?.items && picked.items.length > 0 ? <ChecklistTemplateItems items={picked.items} locale={locale} labels={labels} /> : null;
}

/**
 * The pick: in edit mode, a select of the active templates of the Trade, and the
 * one already picked, kept while the Trade is the same; the form renders the picked
 * Version's items after the field (PickedTemplateItems), below its help. In read mode,
 * the picked template's name and its items.
 */
export function ChecklistTemplateField({ value, tradeId, choices, required, mode, locale, labels: text, name, onChange, look = "select", tradeName }: ChecklistTemplateFieldProps) {
  const current = typeof value === "string" ? value : "";
  const picked = choices.find((c) => c.id === current);
  const items = <PickedTemplateItems value={value} choices={choices} locale={locale} labels={text} />;
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

  const options = templateOptions(value, tradeId, choices, locale, text);
  if (options.length === 0) return <p className="text-body text-muted">{tradeId === "" ? text.chooseTradeFirst : text.noneForTrade}</p>;
  if (look === "cards") {
    return <TemplateCards value={value} tradeId={tradeId} tradeName={tradeName} choices={choices} required={required} locale={locale} labels={text} name={name} onChange={onChange} />;
  }
  return (
    <Select
      name={name}
      placeholder={text.choose}
      options={required ? options : [{ value: noChoice, label: text.none }, ...options]}
      value={current}
      onValueChange={(v) => onChange?.(v === noChoice ? undefined : v)}
    />
  );
}
