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
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "../data/table.tsx";
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

  const values: CounterValues = { workItemType: type, participantId: chosen(participant), tradeId: chosen(trade), locationId: chosen(location) };
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

  const optional = (options: readonly ChoiceOption[]) => [{ value: NONE, label: text.notCounted }, ...options];

  return (
    <SettingsSection title={text.title} description={text.intro} className={className} data-testid="numbering-counters">
      <div className="flex flex-col gap-2">
        <Table label={text.title}>
          <TableHeader>
            <TableRow>
              <TableHead>{text.counter}</TableHead>
              <TableHead align="end">{text.lastNumber}</TableHead>
              <TableHead>{text.state}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {counters.length === 0 ? (
              <TableEmpty colSpan={3}>
                <p className="p-4 text-sm text-muted">{text.none}</p>
              </TableEmpty>
            ) : (
              counters.map((c) => (
                <TableRow key={c.counterKey}>
                  <TableCell>
                    {/* A counter key isn't a Document Number, but reads left to right like one. */}
                    <bdi dir="ltr" translate="no" className="whitespace-nowrap font-medium tabular-nums">
                      {c.counterKey}
                    </bdi>
                  </TableCell>
                  <TableCell align="end" className="tabular-nums">
                    {c.issued ? formatNumber(c.lastValue, locale, { useGrouping: false }) : "—"}
                  </TableCell>
                  <TableCell>
                    {c.issued || c.startingNumber === null ? (
                      <Badge tone="neutral">{text.inUse}</Badge>
                    ) : (
                      <Badge tone="info">{text.startsAt(formatNumber(c.startingNumber, locale, { useGrouping: false }))}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <form aria-labelledby={startId} onSubmit={submit} className="flex flex-col gap-4 border-t border-border pt-4" noValidate>
        <div className="flex flex-col gap-1">
          <h3 id={startId} className="text-body font-semibold text-text">
            {text.startTitle}
          </h3>
          <p className="text-sm text-muted">{text.startIntro}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={text.type} required>
            <Select
              value={type}
              onValueChange={setType}
              options={workItemTypes.map((t) => ({ value: t.code, label: `${t.name[locale]} (${t.code})` }))}
            />
          </Field>
          <Field label={text.participant}>
            <Select value={participant} onValueChange={setParticipant} options={optional(participants)} />
          </Field>
          <Field label={text.trade}>
            <Select value={trade} onValueChange={setTrade} options={optional(trades)} />
          </Field>
          <Field label={text.location}>
            <Select value={location} onValueChange={setLocation} options={optional(locations)} />
          </Field>
          <Field label={text.startingNumber} required error={start && !validStart ? text.refusals.invalid : undefined}>
            <Input
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
          <p role="alert" className="text-sm text-danger">
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
