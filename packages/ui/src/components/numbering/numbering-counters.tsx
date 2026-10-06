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
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Field, type ChoiceOption } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Select } from "../form/select.tsx";

// Counters and starting numbers on Project Settings → Numbering (RP-315;
// workflow-engine.md §8 "Starting numbers"). For Project Admins only: a
// counter's values reveal a Company's volume (visibility.md scenario 55), so the
// page renders this only when the API returned the counters. A Project moving
// from a paper register continues it: the Project Admin picks the values a
// counter counts by, sees the next number it will issue, and sets its starting
// number while it has issued nothing. Presentational: the page passes what the
// API returns and does the calls.

const copy = {
  en: {
    title: "Counters",
    intro: "Each counter issues the sequence of the numbers it counts. Only Project Admins see counters.",
    counter: "Counter",
    lastNumber: "Last number",
    // eslint-disable-next-line rabaed/no-avoid-terms -- a counter's state (In use, Starts at …), not a Stage or Step.
    state: "State",
    none: "No counters yet. A counter starts with the first number it issues.",
    inUse: "In use",
    startsAt: (n: string) => `Starts at ${n}`,
    startTitle: "Set a starting number",
    startIntro:
      "Continuing a paper register? Set the number the counter issues next, before it issues its first. It can't change after that.",
    type: "Work Item Type",
    participant: "Participant",
    trade: "Trade",
    location: "Location",
    notCounted: "Not counted",
    startingNumber: "Starting number",
    next: "The next number will be",
    used: (n: string) => `This counter has already issued numbers, up to ${n}. Its starting number can't change.`,
    save: "Set starting number",
    saved: "Starting number set. The next number will be",
    refusals: {
      participant_required: "Choose a Participant: the Numbering Pattern counts by it.",
      trade_required: "Choose a Trade: the Numbering Pattern counts by it.",
      location_required: "Choose a Location: the Numbering Pattern counts by it.",
      value_not_found: "That choice is no longer on the Project. Reload the page.",
      type_not_found: "That Work Item Type is no longer on the Project. Reload the page.",
      counter_used: "This counter has issued a number since. Its starting number can't change.",
      project_closed: "The Project is closed.",
      not_found: "You can't change numbering on this Project.",
      invalid: "Enter a whole number from 1 to 9,999,999.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    title: "العدّادات",
    intro: "يُصدر كل عدّاد تسلسل الأرقام التي يعدّها. لا يرى العدّادات إلا مسؤولو المشروع.",
    counter: "العدّاد",
    lastNumber: "آخر رقم",
    state: "الحالة",
    none: "لا توجد عدّادات بعد. يبدأ العدّاد بأول رقم يُصدره.",
    inUse: "مستخدم",
    startsAt: (n: string) => `يبدأ من ${n}`,
    startTitle: "تحديد رقم البداية",
    startIntro: "هل تواصلون سجلًا ورقيًا؟ حدّدوا الرقم الذي يُصدره العدّاد تاليًا قبل أن يُصدر أول رقم. لا يمكن تغييره بعد ذلك.",
    type: "نوع البند",
    participant: "المشارك",
    trade: "التخصص",
    location: "الموقع",
    notCounted: "غير معدود",
    startingNumber: "رقم البداية",
    next: "سيكون الرقم التالي",
    used: (n: string) => `أصدر هذا العدّاد أرقامًا بالفعل حتى ${n}. لا يمكن تغيير رقم بدايته.`,
    save: "تحديد رقم البداية",
    saved: "تم تحديد رقم البداية. سيكون الرقم التالي",
    refusals: {
      participant_required: "اختر مشاركًا: نمط الترقيم يعدّ حسبه.",
      trade_required: "اختر تخصصًا: نمط الترقيم يعدّ حسبه.",
      location_required: "اختر موقعًا: نمط الترقيم يعدّ حسبه.",
      value_not_found: "لم يعد هذا الاختيار في المشروع. أعد تحميل الصفحة.",
      type_not_found: "لم يعد نوع البند هذا في المشروع. أعد تحميل الصفحة.",
      counter_used: "أصدر هذا العدّاد رقمًا منذ ذلك الحين. لا يمكن تغيير رقم بدايته.",
      project_closed: "المشروع مغلق.",
      not_found: "لا يمكنك تغيير الترقيم في هذا المشروع.",
      invalid: "أدخل عددًا صحيحًا من 1 إلى 9,999,999.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
} satisfies Record<Locale, unknown>;

export type CounterRefusal = keyof (typeof copy)["en"]["refusals"];

/** What the API answered: the result, or why it refused. */
export type CounterCall<T> = { ok: true; value: T } | { ok: false; reason: string };

export type NumberingCountersProps = {
  locale: Locale;
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
  counters,
  workItemTypes,
  participants,
  trades,
  locations,
  preview,
  onSetStart,
  className,
}: NumberingCountersProps) {
  const text = copy[locale];
  const titleId = useId();
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
    <section aria-labelledby={titleId} className={cn("flex flex-col gap-6", className)} data-testid="numbering-counters">
      <div className="flex flex-col gap-2">
        <h2 id={titleId} className="text-h6 font-semibold text-text">
          {text.title}
        </h2>
        <p className="text-sm text-muted">{text.intro}</p>
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

      <form aria-labelledby={startId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
    </section>
  );
}
