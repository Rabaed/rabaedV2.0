"use client";

import {
  counterNumber,
  formatNumber,
  maxStartingNumber,
  type BilingualText,
  type CounterPreview,
  type CounterStart,
  type CounterStartRequest,
  type CounterValues,
  type Locale,
  type NumberingCounter,
} from "@rabaed/domain";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Field, type ChoiceOption } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Select } from "../form/select.tsx";
import { SettingsSection } from "../settings/settings-layout.tsx";

// Counters and starting numbers on Project Settings → Numbering (RP-315;
// workflow-engine.md §8 "Starting numbers"). For Project Admins only: a
// counter's values reveal a Company's volume (visibility.md scenario 55), so the
// page renders this only when the API returned the counters. A Project moving
// from a paper register continues it: the Project Admin picks the values a
// counter counts by, sees the next number it will issue, and sets its starting
// number while it has issued nothing. Presentational: the page passes what the
// API returns and does the calls.

export type CounterRefusal =
  | "participant_required"
  | "trade_required"
  | "location_required"
  | "value_not_found"
  | "type_not_found"
  | "counter_used"
  | "project_closed"
  | "not_found"
  | "invalid"
  | "unavailable";

/** The counters section's words, from the app's messages. A number is given already formatted for the locale. */
export type NumberingCountersLabels = {
  title: string;
  intro: string;
  counter: string;
  lastNumber: string;
  state: string;
  none: string;
  inUse: string;
  startsAt: (n: string) => string;
  startTitle: string;
  startIntro: string;
  type: string;
  participant: string;
  trade: string;
  location: string;
  notCounted: string;
  startingNumber: string;
  next: string;
  used: (n: string) => string;
  save: string;
  saved: string;
  refusals: Record<CounterRefusal, string>;
};

/** Which of a counter's values a Work Item Type's pattern counts by. */
export type CountedValues = { participant: boolean; trade: boolean; location: boolean };

/** What the API answered: the result, or why it refused. */
export type CounterCall<T> = { ok: true; value: T } | { ok: false; reason: string };

export type NumberingCountersProps = {
  locale: Locale;
  labels: NumberingCountersLabels;
  /** The Project's counters, as the API returns them to a Project Admin. */
  counters: readonly NumberingCounter[];
  /** The Work Item Types a counter can be started for. */
  workItemTypes: readonly { code: string; name: BilingualText }[];
  /** The values a pattern may count by: the Project's Participants, Trades and Locations, labelled for the page. */
  participants: readonly ChoiceOption[];
  trades: readonly ChoiceOption[];
  locations: readonly ChoiceOption[];
  /**
   * Per Work Item Type code, what the pattern in effect for it counts by. A value it
   * counts by must be chosen (no "Not counted"); one it doesn't is "Not counted",
   * fixed. Absent: every value is optional, and the counter preview says what is missing.
   */
  countedBy?: Readonly<Record<string, CountedValues>>;
  /** The counter some values fall under (GET …/numbering/counter). */
  preview: (values: CounterValues) => Promise<CounterCall<CounterPreview>>;
  /** Sets the starting number (PUT …/numbering/counters/start); the page refreshes the counters on success. */
  onSetStart: (request: CounterStartRequest) => Promise<CounterCall<CounterStart>>;
  className?: string;
};

// A choice can't have an empty value, so "not counted" has its own.
const NONE = "none";
const chosen = (value: string) => (value === NONE ? null : value);

/** Project Settings → Numbering: the counters with their last number, and setting a counter's starting number. */
export function NumberingCounters({
  locale,
  labels: text,
  counters,
  workItemTypes,
  participants,
  trades,
  locations,
  countedBy,
  preview,
  onSetStart,
  className,
}: NumberingCountersProps) {
  const startId = useId();
  const [type, setType] = useState(workItemTypes[0]?.code ?? "");
  const [participant, setParticipant] = useState(participants[0]?.value ?? NONE);
  const [trade, setTrade] = useState(NONE);
  const [location, setLocation] = useState(NONE);
  const [start, setStart] = useState("1");
  const [found, setFound] = useState<CounterCall<CounterPreview> | null>(null);
  const [saved, setSaved] = useState<CounterStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // What the chosen Type's pattern counts by decides each value: required, or not counted.
  const counts = countedBy?.[type];
  const effective = (dimension: keyof CountedValues, value: string, options: readonly ChoiceOption[]) =>
    !counts ? value : counts[dimension] ? (value === NONE ? (options[0]?.value ?? NONE) : value) : NONE;
  const participantValue = effective("participant", participant, participants);
  const tradeValue = effective("trade", trade, trades);
  const locationValue = effective("location", location, locations);
  const values: CounterValues = {
    workItemType: type,
    participantId: chosen(participantValue),
    tradeId: chosen(tradeValue),
    locationId: chosen(locationValue),
  };
  const valuesKey = JSON.stringify(values);

  // The counter the chosen values fall under, again whenever they change.
  useEffect(() => {
    let current = true;
    setFound(null);
    if (!type) return;
    preview(JSON.parse(valuesKey) as CounterValues).then(
      (result) => current && setFound(result),
      () => current && setFound({ ok: false, reason: "unavailable" }),
    );
    return () => {
      current = false;
    };
  }, [valuesKey, type, preview]);

  const startingNumber = /^\d{1,7}$/.test(start.trim()) ? Number(start.trim()) : NaN;
  const validStart = Number.isInteger(startingNumber) && startingNumber >= 1 && startingNumber <= maxStartingNumber;
  const counter = found?.ok ? found.value : null;
  const refusal = (reason: string) => text.refusals[reason as CounterRefusal] ?? text.refusals.unavailable;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(null);
    setError(null);
    if (!validStart) {
      setError(text.refusals.invalid);
      return;
    }
    setPending(true);
    try {
      const result = await onSetStart({ ...values, startingNumber });
      if (result.ok) setSaved(result.value);
      else setError(refusal(result.reason));
    } catch {
      setError(text.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  const notCounted = { value: NONE, label: text.notCounted };
  const optionsOf = (dimension: keyof CountedValues, options: readonly ChoiceOption[]) =>
    !counts ? [notCounted, ...options] : counts[dimension] ? [...options] : [notCounted];
  // The kit's form: light edges.
  const light = "border-border-strong";

  return (
    <SettingsSection title={text.title} description={text.intro} className={className} bodyClassName="px-0 pt-[14px] pb-0 gap-0" data-testid="numbering-counters">
      <div role="region" aria-label={text.title} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
        <table aria-label={text.title} className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-surface-subtle [&>*:first-child]:ps-5 [&>*:last-child]:pe-5">
              <th scope="col" className="border-b border-border-subtle px-3 py-2.5 sm:px-5 text-start text-caption font-semibold whitespace-nowrap text-muted">
                {text.counter}
              </th>
              <th scope="col" className="border-b border-border-subtle px-3 py-2.5 sm:px-5 text-end text-caption font-semibold whitespace-nowrap text-muted">
                {text.lastNumber}
              </th>
              <th scope="col" className="border-b border-border-subtle px-3 py-2.5 sm:px-5 text-start text-caption font-semibold whitespace-nowrap text-muted">
                {text.state}
              </th>
            </tr>
          </thead>
          <tbody>
            {counters.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-4 text-sm text-muted">
                  {text.none}
                </td>
              </tr>
            ) : (
              counters.map((c) => (
                <tr key={c.counterKey} className="border-b border-border-subtle last:border-b-0 [&>*:first-child]:ps-5 [&>*:last-child]:pe-5">
                  <td className="px-3 py-3 sm:px-5">
                    {/* A counter key isn't a Document Number, but reads left to right like one. */}
                    <bdi dir="ltr" translate="no" className="text-[12.5px] font-semibold whitespace-nowrap text-text tabular-nums">
                      {c.counterKey}
                    </bdi>
                  </td>
                  <td className="px-3 py-3 sm:px-5 text-end font-semibold text-text tabular-nums">
                    {c.issued ? formatNumber(c.lastValue, locale, { useGrouping: false }) : "—"}
                  </td>
                  <td className="px-3 py-3 sm:px-5 whitespace-nowrap">
                    {c.issued || c.startingNumber === null ? (
                      <Badge tone="neutral" className="h-[22px] rounded-[6px] px-2 text-[11.5px]">
                        {text.inUse}
                      </Badge>
                    ) : (
                      <Badge tone="info" className="h-[22px] rounded-[6px] px-2 text-[11.5px]">
                        {text.startsAt(formatNumber(c.startingNumber, locale, { useGrouping: false }))}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form aria-labelledby={startId} onSubmit={submit} className="flex flex-col gap-4 border-t border-border-subtle px-5 pt-4 pb-5" noValidate>
        <div className="flex flex-col gap-1">
          <h3 id={startId} className="text-sm font-semibold text-text">
            {text.startTitle}
          </h3>
          <p className="text-sm text-muted">{text.startIntro}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={text.type} required>
            <Select
              className={light}
              value={type}
              onValueChange={setType}
              options={workItemTypes.map((t) => ({ value: t.code, label: `${t.name[locale]} (${t.code})` }))}
            />
          </Field>
          <Field label={text.participant} required={counts?.participant}>
            <Select className={light} disabled={counts && !counts.participant} value={participantValue} onValueChange={setParticipant} options={optionsOf("participant", participants)} />
          </Field>
          <Field label={text.trade} required={counts?.trade}>
            <Select className={light} disabled={counts && !counts.trade} value={tradeValue} onValueChange={setTrade} options={optionsOf("trade", trades)} />
          </Field>
          <Field label={text.location} required={counts?.location}>
            <Select className={light} disabled={counts && !counts.location} value={locationValue} onValueChange={setLocation} options={optionsOf("location", locations)} />
          </Field>
          <Field label={text.startingNumber} required error={start && !validStart ? text.refusals.invalid : undefined}>
            <Input
              className={light}
              inputMode="numeric"
              dir="ltr"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setSaved(null);
              }}
            />
          </Field>
        </div>

        <div aria-live="polite" className="flex min-h-6 flex-col gap-1 text-sm" data-testid="numbering-counter-example">
          {found && !found.ok && <p className="text-muted">{refusal(found.reason)}</p>}
          {counter && counter.issued && (
            <p className="text-text">
              {text.used(formatNumber(counter.lastValue ?? 0, locale, { useGrouping: false }))}
            </p>
          )}
          {counter && !counter.issued && validStart && !saved && (
            <p className="text-text">
              {text.next} <DocNo value={counterNumber(counter, startingNumber)} />
            </p>
          )}
          {saved && (
            <p role="status" className="text-text">
              {text.saved} <DocNo value={saved.nextNumber} />
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending || !counter || counter.issued || !validStart}>
            {text.save}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
