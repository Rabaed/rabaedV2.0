"use client";

import { formatNumber, type BilingualText, type Locale } from "@rabaed/domain";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
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
  /** The button that edits one Participant's code in place. */
  editOf: (company: string) => string;
  saving: string;
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
                <td className={cn(cell, "min-w-32 font-semibold text-text sm:whitespace-nowrap")}>{p.company.legalName[locale]}</td>
                {showOrder && (
                  <td className={cn(cell, "text-muted tabular-nums")}>
                    {p.ordinal === null ? "—" : <bdi dir="ltr">{formatNumber(p.ordinal, locale, { minimumIntegerDigits: 2, useGrouping: false })}</bdi>}
                  </td>
                )}
                <td className={cell}>
                  {canEdit && !p.codeLocked ? (
                    <InlineCode participant={p} locale={locale} labels={labels} onSave={onSave} />
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

/**
 * A Participant's code, edited in place: the code (or "no code yet") with a pencil;
 * the pencil turns it into a box. Enter or leaving the box saves a changed code,
 * Escape puts it back; while it saves the box says so, and a refusal stays on the row.
 */
function InlineCode({
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
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(participant.code ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  // Escape and a finished save close the box without saving on the blur that follows.
  const closing = useRef(false);
  // Where focus goes once the box closes: back to the pencil when the keyboard closed it.
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) input.current?.select();
    else if (refocus.current) {
      refocus.current = false;
      edit.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (!editing) setValue(participant.code ?? "");
  }, [participant.code, editing]);

  const close = (focusEdit: boolean) => {
    closing.current = true;
    setEditing(false);
    setError(null);
    refocus.current = focusEdit;
  };

  async function save(focusEdit: boolean) {
    const code = value.trim();
    if (code === (participant.code ?? "")) return close(focusEdit);
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await onSave(participant.id, code);
      if (result.ok) {
        setSaved(true);
        close(focusEdit);
      } else {
        setError(labels.refusals[result.reason]);
        input.current?.focus();
      }
    } catch {
      setError(labels.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue(participant.code ?? "");
      close(true);
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Printed code={participant.code} locked={false} labels={labels} />
        <IconButton
          ref={edit}
          size="sm"
          label={labels.editOf(name)}
          onClick={() => {
            closing.current = false;
            setSaved(false);
            setEditing(true);
          }}
        >
          <Icon name="edit" size={15} />
        </IconButton>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1 text-caption text-success-fg">
            <Icon name="circle-check" size={14} />
            {labels.saved}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <input
          ref={input}
          aria-label={labels.codeOf(name)}
          aria-invalid={error ? true : undefined}
          aria-busy={pending || undefined}
          readOnly={pending}
          dir="ltr"
          maxLength={6}
          autoCapitalize="characters"
          value={value}
          placeholder={labels.noCode}
          onChange={(e) => {
            // Codes are stored in capitals; show them so while typing.
            setValue(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (closing.current || pending) return;
            void save(false);
          }}
          className={cn(
            "h-8 w-24 rounded-sm bg-surface px-2.5 text-sm font-semibold text-text shadow-[inset_0_0_0_1px_var(--border-strong)] pointer-coarse:h-11",
            "placeholder:font-normal placeholder:text-muted hover:shadow-[inset_0_0_0_1px_var(--control-border)]",
            "aria-invalid:shadow-[inset_0_0_0_1px_var(--danger)] read-only:bg-surface-subtle",
            focusRing,
          )}
        />
        {pending && (
          <span role="status" className="text-caption text-muted">
            {labels.saving}
          </span>
        )}
      </span>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
