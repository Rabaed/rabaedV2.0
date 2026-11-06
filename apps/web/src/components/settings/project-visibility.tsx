"use client";

import { baseRoles, dimensionKinds, type DimensionKind, type DimensionValue, type DimensionValues, type Locale, type ParticipantVisibility } from "@rabaed/domain";
import {
  Avatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Icon,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetFooter,
  cn,
  useToast,
} from "@rabaed/ui";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { useHandover, type HandoverOutcome } from "@/components/handover";
import { DimensionCard, draftOf, stored, type Draft, type Grant } from "@/components/participants/member-visibility-editor";
import { sheetOnPhone } from "@/components/participants/participants-parts";
import { useRouter } from "@/i18n/navigation";

// Project Settings → Visibility to the owner's reference (RP-1156, gap rows 20 to 34): the Project's
// Visibility Gap, each Participant's Visibility as chips with an Edit panel, and the pending
// invitations by CR number (ADR 0009). The page is the Project Admins' only (V15).

type BaseRole = (typeof baseRoles)[number];

/** The Project Role chip's colours (the reference's role chips). */
const roleTone: Partial<Record<BaseRole, string>> = {
  owner: "bg-stage-approved-bg text-stage-approved-fg",
  consultant: "bg-info-tint text-info-fg",
  contractor: "bg-brand-tint text-brand-fg",
};

export function RoleChip({ role, name }: { role: BaseRole; name: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-px text-xs font-semibold", roleTone[role] ?? "bg-neutral-tint text-neutral-fg")}>
      {name}
    </span>
  );
}

/** A value as a chip: its name (or path) and its code, left-to-right. */
function ValueChip({ label, code, tone = "plain" }: { label: ReactNode; code?: string; tone?: "plain" | "all" | "gap" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-xs font-medium",
        tone === "all" && "border-transparent bg-stage-approved-bg text-stage-approved-fg",
        tone === "plain" && "border-border bg-surface text-text",
        tone === "gap" && "border-warning-tint bg-surface text-text",
      )}
    >
      {label}
      {code && (
        <bdi dir="ltr" className="font-mono text-[11px] font-semibold text-muted">
          {code}
        </bdi>
      )}
    </span>
  );
}

const byIdOf = (values: DimensionValue[]) => new Map(values.map((v) => [v.id, v]));

function pathOf(v: DimensionValue, byId: ReadonlyMap<string, DimensionValue>, locale: Locale): string {
  const names = [v.name[locale]];
  for (let p = v.parentId; p !== null; p = byId.get(p)?.parentId ?? null) {
    const parent = byId.get(p);
    if (!parent) break;
    names.unshift(parent.name[locale]);
  }
  return names.join(" › ");
}

/** The values to name for a set: each one whose parent is not in the set too (the parent names its subtree). */
function topsOf(values: DimensionValue[], inSet: (id: string) => boolean): DimensionValue[] {
  return values.filter((v) => inSet(v.id) && (v.parentId === null || !inSet(v.parentId)));
}

/**
 * What a Participant covers in one dimension, as the reference shows it (row 30): "All …" when its
 * grant is all; else each covered Location whose parent isn't, and a partly covered one as
 * "Tower 2 … except Tower 2 › Roof" when it covers more of it than not.
 */
function CoveredSummary({ kind, all, grant, covered }: { kind: DimensionKind; all: DimensionValue[]; grant: { isAll: boolean }; covered: DimensionValue[] }) {
  const t = useTranslations("projectVisibility");
  const locale = useLocale() as Locale;
  if (grant.isAll) return <ValueChip tone="all" label={t(kind === "trade" ? "allTrades" : "allLocations")} />;
  if (covered.length === 0) return <span className="text-sm text-muted">{t("none")}</span>;
  const byId = byIdOf(all);
  const isCovered = new Set(covered.map((v) => v.id));
  const childrenOf = (id: string) => all.filter((v) => v.parentId === id);
  const below = (id: string): DimensionValue[] => childrenOf(id).flatMap((c) => [c, ...below(c.id)]);

  const chips: DimensionValue[] = [];
  const excepts: DimensionValue[] = [];
  const visit = (v: DimensionValue) => {
    if (isCovered.has(v.id)) return void chips.push(v);
    const inside = below(v.id);
    const yes = inside.filter((c) => isCovered.has(c.id)).length;
    if (yes === 0) return;
    if (yes >= inside.length - yes) {
      chips.push(v);
      excepts.push(...topsOf(inside, (id) => !isCovered.has(id)));
      return;
    }
    childrenOf(v.id).forEach(visit);
  };
  all.filter((v) => v.parentId === null).forEach(visit);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((v) => (
          <ValueChip key={v.id} label={v.parentId ? pathOf(v, byId, locale) : v.name[locale]} code={v.code} />
        ))}
      </div>
      {excepts.length > 0 && (
        <p className="text-xs text-muted">{t("except", { places: excepts.map((v) => pathOf(v, byId, locale)).join(locale === "ar" ? "، " : ", ") })}</p>
      )}
    </div>
  );
}

/** The Visibility Gap (rows 25 to 28): what no active Participant covers, or the blue all-clear. */
export function ProjectGapNotice({ gap, dimensions }: { gap: DimensionValues; dimensions: DimensionValues }) {
  const t = useTranslations("projectVisibility");
  const locale = useLocale() as Locale;
  const kinds = dimensionKinds.filter((k) => gap[k].length > 0);
  if (kinds.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-[12px] border border-info-tint bg-info-tint px-4 py-3 text-sm text-info-fg" data-testid="no-visibility-gap">
        <Icon name="circle-check" size={18} className="shrink-0" />
        {t("noGap")}
      </p>
    );
  }
  return (
    <section className="flex gap-3 rounded-[12px] border border-warning-tint bg-warning-tint px-4 py-3.5 text-warning-fg" aria-label={t("gapTitle")} data-testid="visibility-gap">
      <Icon name="alert-triangle" size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm">
          <strong className="font-semibold">{t("gapTitle")}</strong> · {t("gapBody")}
        </p>
        <ul className="flex flex-wrap gap-2">
          {kinds.flatMap((kind) => {
            const ids = new Set(gap[kind].map((v) => v.id));
            const byId = byIdOf(dimensions[kind]);
            return topsOf(gap[kind], (id) => ids.has(id)).map((v) => (
              <li key={v.id}>
                <ValueChip tone="gap" label={<><Icon name={kind === "trade" ? "category" : "map-pin"} size={13} className="text-muted" />{pathOf(v, byId, locale)}</>} code={v.code} />
              </li>
            ));
          })}
        </ul>
        <p className="text-xs">{t("gapSource")}</p>
      </div>
    </section>
  );
}

export type ParticipantRow = {
  id: string;
  company: string;
  role: BaseRole;
  roleName: string;
  /** Null when the read failed. */
  grant: ParticipantVisibility | null;
};

export type InvitationRow = { id: string; crNumber: string; role: BaseRole; roleName: string; invitedAt: string };

/** The Participants table (rows 29 to 34) with the pending invitations under it. */
export function ParticipantsVisibility({
  projectId,
  dimensions,
  participants,
  invitations,
}: {
  projectId: string;
  dimensions: DimensionValues;
  participants: ParticipantRow[];
  invitations: InvitationRow[];
}) {
  const t = useTranslations("projectVisibility");
  const [editing, setEditing] = useState<ParticipantRow | null>(null);
  return (
    <section className="overflow-hidden rounded-[14px] border border-border bg-surface" aria-label={t("participant")}>
      <div className="hidden grid-cols-[minmax(220px,1.3fr)_1.2fr_1.4fr_auto] gap-4 border-b border-border bg-canvas px-5 py-3 text-xs font-semibold text-muted md:grid">
        <span>{t("participant")}</span>
        <span>{t("tradesCovered")}</span>
        <span>{t("locationsCovered")}</span>
        <span className="w-20" />
      </div>
      <ul data-testid="participants-visibility">
        {participants.map((p) => (
          <li key={p.id} className="grid gap-3 border-b border-border px-5 py-4 last:border-b-0 md:grid-cols-[minmax(220px,1.3fr)_1.2fr_1.4fr_auto] md:items-center md:gap-4" data-testid="participant-visibility">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={p.company} kind="company" size="lg" decorative />
              <div className="min-w-0 space-y-1">
                <p className="truncate font-semibold text-text">{p.company}</p>
                <RoleChip role={p.role} name={p.roleName} />
              </div>
            </div>
            {p.grant ? (
              <>
                <Cell label={t("tradesCovered")}>
                  <CoveredSummary kind="trade" all={dimensions.trade} grant={p.grant.visibility.trade} covered={p.grant.covered.trade} />
                </Cell>
                <Cell label={t("locationsCovered")}>
                  <CoveredSummary kind="location" all={dimensions.location} grant={p.grant.visibility.location} covered={p.grant.covered.location} />
                </Cell>
                <Button variant="secondary" size="sm" className="justify-self-start md:justify-self-end" onClick={() => setEditing(p)} aria-label={t("editLabel", { company: p.company })}>
                  <Icon name="edit" size={15} />
                  {t("edit")}
                </Button>
              </>
            ) : (
              <p role="alert" className="text-sm text-danger-fg md:col-span-3">
                {t("unavailableGrant")}
              </p>
            )}
          </li>
        ))}
        {invitations.map((i) => (
          <InvitationItem key={i.id} projectId={projectId} invitation={i} />
        ))}
      </ul>
      {editing?.grant && <EditSheet participant={editing} grant={editing.grant} dimensions={dimensions} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-muted md:sr-only">{label}</p>
      {children}
    </div>
  );
}

/** A pending invitation (rows 23 and 24): by CR number and Project Role only, never a Company's name; Withdraw asks first. */
function InvitationItem({ projectId, invitation }: { projectId: string; invitation: InvitationRow }) {
  const t = useTranslations("projectVisibility");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function withdraw() {
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/invitations/${invitation.id}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return setError(true);
      setConfirming(false);
      toast({ title: t("withdrawnToast"), tone: "success" });
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="grid gap-3 border-b border-border bg-canvas/60 px-5 py-4 last:border-b-0 md:grid-cols-[minmax(220px,1.3fr)_1.2fr_1.4fr_auto] md:items-center md:gap-4" data-testid="pending-invitation">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xs border border-dashed border-border-strong text-muted" aria-hidden>
          <Icon name="mail" size={18} />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-text">
            {t("crNumber")} <bdi dir="ltr" className="font-mono">{invitation.crNumber}</bdi>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <RoleChip role={invitation.role} name={invitation.roleName} />
            <span className="text-xs text-muted">
              {t("pending", { age: format.relativeTime(new Date(invitation.invitedAt), now) })}
            </span>
          </div>
        </div>
      </div>
      <span className="hidden md:block" />
      <span className="hidden md:block" />
      <Button variant="ghost" size="sm" className="justify-self-start border border-border md:justify-self-end" onClick={() => setConfirming(true)} aria-label={t("withdrawLabel", { cr: invitation.crNumber })}>
        {t("withdraw")}
      </Button>
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && setConfirming(false)}>
          <DialogContent className={sheetOnPhone} closeLabel={t("close")} title={t("withdrawTitle")} description={t("withdrawBody", { cr: invitation.crNumber })}>
            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {t("unavailable")}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t("cancel")}</Button>
              </DialogClose>
              <Button variant="danger" disabled={pending} onClick={() => void withdraw()}>
                {t("withdraw")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

/** Edit a Participant's Visibility (rows 31 and 32): a side panel with the Trades and Locations cards. */
function EditSheet({ participant, grant, dimensions, onClose }: { participant: ParticipantRow; grant: ParticipantVisibility; dimensions: DimensionValues; onClose: () => void }) {
  const t = useTranslations("projectVisibility");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const handover = useHandover();
  const [draft, setDraft] = useState<Draft>(() => draftOf(grant.visibility));
  const [pending, setPending] = useState(false);
  const saved = draftOf(grant.visibility);
  const dirty = dimensionKinds.some((k) => JSON.stringify(stored(dimensions[k], draft[k])) !== JSON.stringify(stored(dimensions[k], saved[k])));

  async function save() {
    setPending(true);
    const errors: Record<string, string> = {
      exceeds_participant: t("exceedsParticipant"),
      forbidden: t("notAllowed"),
      project_closed: t("projectClosed"),
    };
    try {
      // The Steps it takes the Participant's Members off are handed over first (RP-108).
      await handover.run({
        action: "save",
        method: "PUT",
        url: `/api/v1/participants/${participant.id}/visibility`,
        body: Object.fromEntries(dimensionKinds.map((kind) => [kind, stored(dimensions[kind], draft[kind])])),
        done: (outcome: HandoverOutcome) => {
          if (outcome.kind === "done") {
            toast({ title: t("savedToast"), tone: "success" });
            onClose();
            return router.refresh();
          }
          toast({ title: outcome.kind === "refused" ? outcome.message : (errors[outcome.code ?? ""] ?? t("unavailable")), tone: "danger" });
        },
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex max-w-[620px] flex-col" closeLabel={t("close")} title={t("editTitle", { company: participant.company })} description={t("editHint")}>
        <div className="flex-1 space-y-4">
          {dimensionKinds.map((kind) => (
            <DimensionCard
              key={kind}
              kind={kind}
              title={t(kind === "trade" ? "trades" : "locations")}
              allLabel={t(kind === "trade" ? "allTrades" : "allLocations")}
              emptyText={t("noValues")}
              values={dimensions[kind]}
              grant={draft[kind]}
              readOnly={false}
              locale={locale}
              onChange={(g: Grant) => setDraft((prev) => ({ ...prev, [kind]: g }))}
            />
          ))}
        </div>
        <SheetFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!dirty || pending || handover.pending} onClick={() => void save()}>
            {t("save")}
          </Button>
        </SheetFooter>
        {handover.dialog}
      </SheetContent>
    </Sheet>
  );
}

/** "Add Participant" (rows 20 to 22): CR number and Project Role; the same answer whatever the CR number (ADR 0009). */
export function AddParticipantButton({ projectId }: { projectId: string }) {
  const t = useTranslations("projectVisibility");
  const tRoles = useTranslations("projects.roles");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ crNumber: String(form.get("crNumber") ?? "").trim(), role: form.get("role") }),
      });
      if (res.status === 202) {
        setOpen(false);
        toast({ title: t("sentToast"), tone: "success" });
        return router.refresh();
      }
      const errors: Record<number, string> = { 400: t("invalidCr"), 403: t("notAdmin"), 409: t("alreadyParticipant") };
      setError(errors[res.status] ?? t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <Button className="max-sm:w-full" onClick={() => setOpen(true)}>
        <Icon name="person-add" size={16} />
        {t("addParticipant")}
      </Button>
      <DialogContent className={sheetOnPhone} closeLabel={t("close")} title={t("addTitle")} description={t("addHint")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t("crNumber")} id="add-participant-cr" required>
            <Input name="crNumber" dir="ltr" inputMode="numeric" maxLength={10} autoFocus className="font-mono" />
          </Field>
          <Field label={t("role")} id="add-participant-role">
            <Select name="role" defaultValue="consultant" options={baseRoles.map((role) => ({ value: role, label: tRoles(role) }))} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {t("invite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
