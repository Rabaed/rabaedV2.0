"use client";

import { participantSegment, type BilingualText, type Locale } from "@rabaed/domain";
import { useId, useState, type FormEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";

// Participant Codes on Project Settings → Numbering (RP-381, spec RP-311). Each
// Participant with what its Document Numbers print: its Participant Code, or its
// position (01) until one is set. A Project Admin sets the codes here; every other
// Project Member reads them. The page passes only the Participants the API lists
// for the viewer (V15: a Project Admin gets every one, anyone else only their own
// Company's), so this shows nothing beyond that. Presentational: the page does
// the calls, and the API keeps its refusals (2-6 letters or digits with at least
// one letter, unique in the Project, fixed once used).

export type ParticipantCodesLabels = {
  title: string;
  intro: string;
  /** The list's name. */
  participants: string;
  code: string;
  /** Beside a position shown in place of a code. */
  position: string;
  save: string;
  saved: string;
  refusals: Record<ParticipantCodeRefusal, string>;
};

export type ParticipantCodeRefusal = "invalid" | "duplicate_code" | "code_in_use" | "forbidden" | "unavailable";

export type ParticipantCodesProps = {
  locale: Locale;
  participants: readonly { id: string; company: { legalName: BilingualText }; code: string | null; ordinal: number }[];
  /** A Project Admin: each row is a form. */
  canEdit: boolean;
  labels: ParticipantCodesLabels;
  /** Sets the code (PUT /v1/participants/:id/code); the page refreshes on success. */
  onSave: (participantId: string, code: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  className?: string;
};

/** Project Settings → Numbering: each Participant's Participant Code, set by a Project Admin. */
export function ParticipantCodes({ locale, participants, canEdit, labels, onSave, className }: ParticipantCodesProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("flex flex-col gap-2", className)} data-testid="participant-codes">
      <h2 id={titleId} className="text-h6 font-semibold text-text">
        {labels.title}
      </h2>
      <p className="text-sm text-muted">{labels.intro}</p>
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
    </section>
  );
}

/** What the Participant's numbers print, always left to right; a position says so. */
function Printed({ participant, labels }: { participant: { code: string | null; ordinal: number }; labels: ParticipantCodesLabels }) {
  return (
    <span className="text-sm">
      <bdi dir="ltr" translate="no" className="font-medium tabular-nums">
        {participantSegment(participant)}
      </bdi>
      {participant.code === null && (
        <span className="text-muted">
          {" · "}
          <span>{labels.position}</span>
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
      else setError(labels.refusals[result.reason as ParticipantCodeRefusal] ?? labels.refusals.unavailable);
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
