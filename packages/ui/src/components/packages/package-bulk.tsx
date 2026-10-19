"use client";

import {
  formatNumber,
  validateAnswers,
  type BilingualText,
  type BulkOffer,
  type FieldError,
  type FormSchema,
  type Locale,
  type PackageDetailItem,
  type WorkItemRow,
} from "@rabaed/domain";
import { useEffect, useRef, useState, type ComponentType, type ElementType, type FormEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { sayRefusal } from "../../lib/refusal.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { ActionForm, type ActionFormLabels } from "../form-engine/action-form.tsx";
import { Field } from "../form/field.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Select } from "../form/select.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import type { WorkItemTableProps } from "../views/work-item-table.tsx";

// Bulk Transitions on the Package page (RP-661 over RP-646; spec RP-616 stories 39–45; the
// RP-633 reference's bulk bar, as corrected by design/prompts/packages.md "Reference (RP-633)").
// The viewer selects the submittals waiting on them (the API's `bulkTransitions` per item); when
// every selected one offers a Transition with the same key and Action Form (`form`), the bar
// offers it. Its pop-up shows that Action Form once, drawn as a single Transition's is, and
// "Assign to" when the Transition offers it: one set of answers and one Member for all. All or
// nothing: refused, nothing is done, and the pop-up names the item that stopped it, with a link
// to it and why, as the API says it (a reason this page doesn't know reads as a sentence, never
// as its code). There is no signing state: each item is signed as in a single Transition, and
// opening it asks first what a single one asks, the Signature and the Company's Stamp (`gate`).

/** What the pop-up needs to draw a bulk Transition: its Action Form and the Members "Assign to" offers (absent: none). */
export type BulkTransitionForm = {
  actionForm: FormSchema | null;
  assignTo?: { memberId: string; name: BilingualText }[];
};

/** The item that stopped a bulk Transition, as the API names it. `reason` is any of its codes, also one this page doesn't know yet. */
export type BulkStopped = {
  id: string;
  documentNumber: string | null;
  title: string;
  reason: string;
  errors?: FieldError[];
  message?: BilingualText;
};

export type BulkTakeResult = { ok: true } | { ok: false; reason: "bulk_refused"; stoppedBy: BulkStopped } | { ok: false; reason: string };

/** A bulk Transition as the pop-up sends it, confirmed (ADR 0017); the key is kept until it is taken, so a retry takes it once. */
export type BulkTakeRequest = {
  transition: string;
  workItemIds: string[];
  answers: Record<string, unknown>;
  internalNote: string;
  assignTo: string | null;
  confirmed: true;
  idempotencyKey: string;
};

export type PackageBulkLabels = {
  /** The bar's name. */
  bar: string;
  /** In the bar while nothing is selected. */
  hint: string;
  /** E.g. "3 selected". */
  selected: (n: string, count: number) => string;
  /** The bar's Transitions, as a group. */
  transitions: string;
  /** The selected ones share no Transition. */
  noneShared: string;
  clear: string;
  selectAll: string;
  selectRow: (subject: string) => string;
  /** Under the pop-up's heading. */
  description: (n: string, count: number) => string;
  /** The list of the items it is taken on. */
  appliesTo: string;
  noNumber: string;
  loading: string;
  assignTo: string;
  assignToHelp: string;
  assignToPool: string;
  /** The Action Form's answers to fix first. */
  formInvalid: string;
  /** Refused: nothing was done. */
  stoppedTitle: string;
  /** Before the item that stopped it. */
  stoppedBy: string;
  /** Why it stopped, by the API's reason; `unknown` for any other. */
  reasons: Record<string, string> & { unknown: string };
  /** Any other refusal, by the API's error code; `unavailable` for any other. */
  refusals: Record<string, string> & { unavailable: string };
};

export type PackageBulkProps = {
  labels: PackageBulkLabels;
  actionFormLabels: ActionFormLabels;
  /** The Action Form and "Assign to" of `transition` on the item `workItemId` (they all share its Action Form); null when it can't be read. */
  loadForm: (transition: string, workItemId: string) => Promise<BulkTransitionForm | null>;
  onTake: (request: BulkTakeRequest) => Promise<BulkTakeResult>;
  /**
   * What opening a Transition asks first, as a single one's does (the Signature, then the
   * Company's Stamp: RP-85, RP-617): it shows `children`, the bulk pop-up, only once that holds,
   * else its own message, and calls `onClose` when that closes. Absent: the pop-up opens at once.
   */
  gate?: ComponentType<{ onClose: () => void; children: ReactNode }>;
};

/**
 * The bulk Transitions `selected` share: the first one's, kept where every other selected item
 * offers one with the same key and Action Form (spec RP-616 story 41). None for an empty selection.
 */
export function sharedBulkTransitions(items: readonly PackageDetailItem[], selected: ReadonlySet<string>): BulkOffer[] {
  const chosen = items.filter((i) => selected.has(i.id));
  const [first, ...others] = chosen;
  if (!first) return [];
  return first.bulkTransitions.filter((offer) => others.every((i) => i.bulkTransitions.some((o) => o.key === offer.key && o.form === offer.form)));
}

/** The pop-up's choice for "Assign to" that leaves the next Step to its Step Pool. */
const TO_POOL = "pool";

/**
 * The Package page's selection and bulk bar: `selection` for its item table (checkboxes only on
 * the items waiting on the viewer) and `bar`, above the table, with the pop-up. Neither when
 * nothing waits on the viewer, or the page offers no bulk.
 */
export function usePackageBulk({
  items,
  bulk,
  locale,
  close,
  cancel,
  itemHref,
  linkAs,
}: {
  items: readonly PackageDetailItem[];
  bulk: PackageBulkProps | undefined;
  locale: Locale;
  close: string;
  cancel: string;
  itemHref: (id: string) => string;
  linkAs?: ElementType;
}): { selection?: WorkItemTableProps["selection"]; bar: ReactNode } {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [choice, setChoice] = useState<BulkOffer | null>(null);
  const waiting = items.filter((i) => i.bulkTransitions.length > 0);
  if (!bulk || waiting.length === 0) return { bar: null };
  // Only what still waits on the viewer, as the page reads it now.
  const chosen = waiting.filter((i) => picked.has(i.id));
  const selected = new Set(chosen.map((i) => i.id));
  const shared = sharedBulkTransitions(waiting, selected);
  const waitingIds = new Set(waiting.map((i) => i.id));
  const { labels, gate: Gate } = bulk;
  const n = (value: number) => formatNumber(value, locale);
  const closeDialog = () => setChoice(null);
  const dialog =
    choice && chosen.length > 0 ? (
      <BulkTransitionDialog
        offer={choice}
        items={chosen}
        bulk={bulk}
        locale={locale}
        close={close}
        cancel={cancel}
        itemHref={itemHref}
        linkAs={linkAs}
        onClose={closeDialog}
        onTaken={() => {
          setChoice(null);
          setPicked(new Set());
        }}
      />
    ) : null;

  const selection: WorkItemTableProps["selection"] = {
    selected,
    onChange: setPicked,
    selectAll: labels.selectAll,
    selectRow: labels.selectRow,
    selectable: (row: WorkItemRow) => waitingIds.has(row.id),
  };

  const bar = (
    <>
      <div
        role="toolbar"
        aria-label={labels.bar}
        data-bulk-bar={chosen.length > 0 ? "on" : "off"}
        className={cn(
          "flex min-h-[52px] flex-wrap items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 text-sm",
          chosen.length > 0 ? "bg-brand-tint text-brand-fg" : "bg-surface-subtle text-text-secondary",
        )}
      >
        {chosen.length === 0 ? (
          <span className="flex items-center gap-2 text-muted">
            <Icon name="list-check" size={16} />
            {labels.hint}
          </span>
        ) : (
          <>
            <strong className="font-ui text-body font-bold tabular-nums">{labels.selected(n(chosen.length), chosen.length)}</strong>
            <span aria-hidden="true" className="h-5 w-px bg-border" />
            {shared.length > 0 ? (
              <span role="group" aria-label={labels.transitions} className="flex flex-wrap gap-1.5">
                {shared.map((offer) => (
                  <Button key={offer.key} size="sm" variant="secondary" onClick={() => setChoice(offer)}>
                    {offer.label[locale]}
                  </Button>
                ))}
              </span>
            ) : (
              <span className="text-text-secondary">{labels.noneShared}</span>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              <Icon name="x" />
              {labels.clear}
            </Button>
          </>
        )}
      </div>
      {dialog && (Gate ? <Gate onClose={closeDialog}>{dialog}</Gate> : dialog)}
    </>
  );
  return { selection, bar };
}

/** A bulk Transition's pop-up: its Action Form once for all `items`, "Assign to" when offered, and the refusal when one stops it. */
function BulkTransitionDialog({
  offer,
  items,
  bulk,
  locale,
  close,
  cancel,
  itemHref,
  linkAs: Link = "a",
  onClose,
  onTaken,
}: {
  offer: BulkOffer;
  items: PackageDetailItem[];
  bulk: PackageBulkProps;
  locale: Locale;
  close: string;
  cancel: string;
  itemHref: (id: string) => string;
  linkAs?: ElementType | undefined;
  onClose: () => void;
  onTaken: () => void;
}) {
  const { labels } = bulk;
  const [form, setForm] = useState<BulkTransitionForm | "loading" | null>("loading");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [internalNote, setInternalNote] = useState("");
  const [assignTo, setAssignTo] = useState(TO_POOL);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<BulkStopped | null>(null);
  const [pending, setPending] = useState(false);
  // Kept until it is taken, so a double click or a retry takes it once.
  const key = useRef<string | null>(null);
  const firstId = items[0]!.id;

  useEffect(() => {
    let live = true;
    bulk.loadForm(offer.key, firstId).then(
      (read) => live && setForm(read),
      () => live && setForm(null),
    );
    return () => {
      live = false;
    };
    // Read once, for the Transition the pop-up opened with.
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form === "loading" || form === null) return;
    setError(null);
    setStopped(null);
    // The API's own checks, before sending.
    const checked = form.actionForm ? validateAnswers(form.actionForm, answers, "complete") : { ok: true as const, answers: {} };
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      return setError(labels.formInvalid);
    }
    setFieldErrors([]);
    key.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await bulk.onTake({
        transition: offer.key,
        workItemIds: items.map((i) => i.id),
        answers: checked.answers,
        internalNote: internalNote.trim(),
        assignTo: assignTo === TO_POOL ? null : assignTo,
        confirmed: true,
        idempotencyKey: key.current,
      });
      if (result.ok) return onTaken();
      if ("stoppedBy" in result) {
        setStopped(result.stoppedBy);
        // The Action Form's own answers, as the item's Transition refused them: marked on the fields.
        if (result.stoppedBy.reason === "invalid_action_form" && result.stoppedBy.errors) setFieldErrors(result.stoppedBy.errors);
      } else setError(sayRefusal(labels.refusals, result.reason));
    } catch {
      setError(labels.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  const why = (s: BulkStopped) => s.message?.[locale] ?? labels.reasons[s.reason] ?? labels.reasons.unknown;
  const label = offer.label[locale];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={label} description={labels.description(formatNumber(items.length, locale), items.length)} closeLabel={close} className="w-[min(36rem,calc(100%-2rem))]">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <ul aria-label={labels.appliesTo} className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-border">
            {items.map((i) => (
              <li key={i.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm not-first:border-t not-first:border-border-subtle">
                {i.documentNumber ? <DocNo value={i.documentNumber} className="font-ui font-normal text-muted" /> : <span className="shrink-0 text-muted">{labels.noNumber}</span>}
                <span dir="auto" className="truncate font-medium text-text">
                  {i.title}
                </span>
              </li>
            ))}
          </ul>
          {form === "loading" ? (
            <p className="text-sm text-muted">{labels.loading}</p>
          ) : form === null ? (
            <p role="alert" className="text-sm text-danger-fg">
              {labels.refusals.unavailable}
            </p>
          ) : (
            <>
              <ActionForm
                schema={form.actionForm}
                answers={answers}
                errors={fieldErrors}
                internalNote={internalNote}
                locale={locale}
                labels={bulk.actionFormLabels}
                onChange={(changes) => setAnswers((current) => ({ ...current, ...changes }))}
                onInternalNoteChange={setInternalNote}
                idPrefix="bulk-transition"
              />
              {form.assignTo && (
                <Field label={labels.assignTo} help={labels.assignToHelp} id="bulk-transition-assign-to">
                  <Select
                    value={assignTo}
                    onValueChange={setAssignTo}
                    options={[{ value: TO_POOL, label: labels.assignToPool }, ...form.assignTo.map((m) => ({ value: m.memberId, label: m.name[locale] }))]}
                  />
                </Field>
              )}
            </>
          )}
          {stopped && (
            <section aria-labelledby="bulk-stopped" role="alert" data-stopped={stopped.reason} className="flex flex-col gap-2 rounded-md border border-danger bg-danger-tint p-3">
              <h3 id="bulk-stopped" className="flex items-center gap-2 text-sm font-bold text-danger-fg">
                <Icon name="alert-triangle" size={16} />
                {labels.stoppedTitle}
              </h3>
              <p className="text-sm text-text">{labels.stoppedBy}</p>
              <div className="flex flex-col rounded-sm bg-surface px-3 py-2 text-sm">
                <Link href={itemHref(stopped.id)} className={cn("flex min-w-0 items-center gap-2 font-semibold text-text hover:text-brand-fg", focusRing)}>
                  {stopped.documentNumber ? <DocNo value={stopped.documentNumber} className="font-ui font-normal text-muted" /> : <span className="text-muted">{labels.noNumber}</span>}
                  <span dir="auto" className="truncate">
                    {stopped.title}
                  </span>
                </Link>
                <span className="text-muted">{why(stopped)}</span>
              </div>
            </section>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{cancel}</Button>
            </DialogClose>
            <Button type="submit" disabled={pending || form === "loading" || form === null}>
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
