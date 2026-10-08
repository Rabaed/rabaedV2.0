"use client";

import { participantSegment, type BilingualText, type Locale } from "@rabaed/domain";
import { useState, type FormEvent } from "react";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SettingsSection } from "../settings/settings-layout.tsx";

// Participant Codes on Project Settings → Numbering (RP-381, spec RP-311). Each
// Participant with what its Document Numbers print: its Participant Code, or its
// order on the Project (01) until one is set. A Project Admin sets the codes here;
// every other Project Member reads them. The page passes only the Participants the
// API lists for the viewer (V15: a Project Admin gets every one, anyone else only
// their own Company's), so this shows nothing beyond that; and the API gives the
// order on the Project only to Project Admins (RP-381-1), so anyone else reads a
// plain "no code yet" in its place. Presentational: the page does
// the calls, and the API keeps its refusals (2-6 letters or digits with at least
// one letter, unique in the Project, fixed once used).

export type ParticipantCodesLabels = {
  title: string;
  intro: string;
  /** The list's name. */
  participants: string;
  code: string;
  /** Beside the order on the Project, shown to a Project Admin in place of a code. */
  order: string;
  /** In place of a code, for a viewer the order on the Project isn't given to. */
  noCode: string;
  save: string;
  saved: string;
  refusals: Record<ParticipantCodeRefusal, string>;
};

export type ParticipantCodeRefusal = "invalid" | "duplicate_code" | "code_in_use" | "forbidden" | "unavailable";

export type ParticipantCodesProps = {
  locale: Locale;
  participants: readonly { id: string; company: { legalName: BilingualText }; code: string | null; ordinal: number | null }[];
  /** A Project Admin: each row is a form. */
  canEdit: boolean;
  labels: ParticipantCodesLabels;
  /** Sets the code (PUT /v1/participants/:id/code); the page refreshes on success. */
  onSave: (participantId: string, code: string) => Promise<{ ok: true } | { ok: false; reason: ParticipantCodeRefusal }>;
  className?: string;
};

/** Project Settings → Numbering: each Participant's Participant Code, set by a Project Admin. */
export function ParticipantCodes({ locale, participants, canEdit, labels, onSave, className }: ParticipantCodesProps) {
  return (
    <SettingsSection title={labels.title} description={labels.intro} className={className} data-testid="participant-codes">
      <ul aria-label={labels.participants} className="divide-y divide-border border-y border-border">
        {participants.map((p) => (
          <li key={p.id} className="py-3">
            {canEdit ? (
              <CodeForm participant={p} locale={locale} labels={labels} onSave={onSave} />
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <span className="font-medium text-text">{p.company.legalName[locale]}</span>
                <Printed participant={p} labels={labels} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}

/**
 * What the Participant's numbers print, always left to right; the order on the
 * Project says so. Without a code or an order, a plain "no code yet".
 */
function Printed({
  participant: { code, ordinal },
  labels,
}: {
  participant: { code: string | null; ordinal: number | null };
  labels: ParticipantCodesLabels;
}) {
  const printed = ordinal === null ? code : participantSegment({ code, ordinal });
  if (printed === null) return <span className="text-sm text-muted">{labels.noCode}</span>;
  return (
    <span className="text-sm">
      <bdi dir="ltr" translate="no" className="font-medium tabular-nums">
        {printed}
      </bdi>
      {code === null && (
        <span className="text-muted">
          {" · "}
          <span>{labels.order}</span>
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
    <form aria-label={name} onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <span className="font-medium text-text">{name}</span>
        <Printed participant={participant} labels={labels} />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={labels.code}>
          <Input
            dir="ltr"
            maxLength={6}
            autoCapitalize="characters"
            value={value}
            onChange={(e) => {
              // Codes are stored in capitals; show them so while typing.
              setValue(e.target.value.toUpperCase());
              setSaved(false);
            }}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {labels.save}
        </Button>
      </div>
      {saved && (
        <p role="status" className="text-sm text-text">
          {labels.saved}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
