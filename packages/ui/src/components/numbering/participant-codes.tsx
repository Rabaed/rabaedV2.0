"use client";

import { formatNumber, type BilingualText, type Locale } from "@rabaed/domain";
import { useState, type FormEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { SettingsSection } from "../settings/settings-layout.tsx";

// Participant Codes on Project Settings → Document Numbering (RP-381, spec RP-311;
// restyled to the kit's cards in the RP-412 rebuild): a table of the Participants
// with their order on the Project and their code, edited in place by a Project
// Admin; a code a Document Number fixed shows a lock. Every other Project Member
// reads the codes of the Participants the API lists for them (V15: only their own
// Company's), and the order on the Project is given to Project Admins only
// (RP-381-1), so its column is theirs alone. Presentational: the page does the
// calls; the API keeps its refusals (2-6 letters or digits with at least one
// letter, unique in the Project, fixed once used).

export type ParticipantCodesLabels = {
  title: string;
  intro: string;
  /** The table's name. */
  participants: string;
  colParticipant: string;
  colOrder: string;
  colCode: string;
  /** The code input's name, for one Participant. */
  codeOf: (company: string) => string;
  /** Beside a code a Document Number fixed. */
  locked: string;
  /** In place of a code not set yet. */
  noCode: string;
  save: string;
  saved: string;
  refusals: Record<ParticipantCodeRefusal, string>;
};

export type ParticipantCodeRefusal = "invalid" | "duplicate_code" | "code_in_use" | "forbidden" | "unavailable";

export type ParticipantCodesProps = {
  locale: Locale;
  participants: readonly { id: string; company: { legalName: BilingualText }; code: string | null; ordinal: number | null; codeLocked: boolean }[];
  /** A Project Admin: each code is edited in place. */
  canEdit: boolean;
  labels: ParticipantCodesLabels;
  /** Sets the code (PUT /v1/participants/:id/code); the page refreshes on success. */
  onSave: (participantId: string, code: string) => Promise<{ ok: true } | { ok: false; reason: ParticipantCodeRefusal }>;
  className?: string;
};

const cell = "px-5 py-3 align-middle";
const head = "border-b border-border-subtle bg-surface-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted";

/** Project Settings → Document Numbering: each Participant's Participant Code. */
export function ParticipantCodes({ locale, participants, canEdit, labels, onSave, className }: ParticipantCodesProps) {
  const showOrder = participants.some((p) => p.ordinal !== null);
  return (
    <SettingsSection title={labels.title} description={labels.intro} className={className} bodyClassName="px-0 pt-[14px] pb-0" data-testid="participant-codes">
      <div role="region" aria-label={labels.participants} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th scope="col" className={head}>
                {labels.colParticipant}
              </th>
              {showOrder && (
                <th scope="col" className={head}>
                  {labels.colOrder}
                </th>
              )}
              <th scope="col" className={cn(head, "w-full")}>
                {labels.colCode}
              </th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id} className="border-b border-border-subtle last:border-b-0" data-testid="participant-code-row">
                <td className={cn(cell, "font-semibold whitespace-nowrap text-text")}>{p.company.legalName[locale]}</td>
                {showOrder && (
                  <td className={cn(cell, "text-muted tabular-nums")}>
                    {p.ordinal === null ? "—" : <bdi dir="ltr">{formatNumber(p.ordinal, locale, { minimumIntegerDigits: 2, useGrouping: false })}</bdi>}
                  </td>
                )}
                <td className={cell}>
                  {canEdit && !p.codeLocked ? (
                    <CodeForm participant={p} locale={locale} labels={labels} onSave={onSave} />
                  ) : (
                    <Printed code={p.code} locked={p.codeLocked} labels={labels} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

function Printed({ code, locked, labels }: { code: string | null; locked: boolean; labels: ParticipantCodesLabels }) {
  return (
    <span className="inline-flex items-center gap-2">
      {code === null ? (
        <span className="text-sm text-muted">{labels.noCode}</span>
      ) : (
        <bdi dir="ltr" translate="no" className="rounded-[5px] bg-segment-participant-tint px-1.5 py-px text-caption font-bold text-segment-participant-fg">
          {code}
        </bdi>
      )}
      {locked && (
        <span className="inline-flex items-center gap-1 text-caption text-muted">
          <Icon name="lock" size={14} />
          {labels.locked}
        </span>
      )}
    </span>
  );
}

function CodeForm({
  participant,
  locale,
  labels,
  onSave,
}: {
  participant: ParticipantCodesProps["participants"][number];
  locale: Locale;
  labels: ParticipantCodesLabels;
  onSave: ParticipantCodesProps["onSave"];
}) {
  const name = participant.company.legalName[locale];
  const [value, setValue] = useState(participant.code ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await onSave(participant.id, value.trim());
      if (result.ok) setSaved(true);
      else setError(labels.refusals[result.reason]);
    } catch {
      setError(labels.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={name} onSubmit={submit} className="flex flex-col gap-1" noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={labels.codeOf(name)}
          aria-invalid={error ? true : undefined}
          dir="ltr"
          maxLength={6}
          autoCapitalize="characters"
          value={value}
          placeholder={labels.noCode}
          onChange={(e) => {
            // Codes are stored in capitals; show them so while typing.
            setValue(e.target.value.toUpperCase());
            setSaved(false);
          }}
          className={cn(
            "h-8 w-28 rounded-sm border border-control-border pointer-coarse:h-11 bg-surface px-2.5 text-sm font-semibold text-text placeholder:font-normal placeholder:text-muted hover:border-control-border-hover",
            "aria-invalid:border-danger",
            focusRing,
          )}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={pending || value.trim() === (participant.code ?? "")}>
          {labels.save}
        </Button>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1 text-caption text-success-fg">
            <Icon name="circle-check" size={14} />
            {labels.saved}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
