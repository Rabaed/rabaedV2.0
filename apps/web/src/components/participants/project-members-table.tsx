"use client";

import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Icon,
  IconButton,
  Select,
  cn,
  useToast,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useHandover, type HandoverRequest } from "@/components/handover";
import { Link, useRouter } from "@/i18n/navigation";
import { outlined, sheetOnPhone } from "./participants-parts";

type Position = { key: string; name: string };

export type MemberRow = {
  id: string;
  name: string;
  /** For the Avatar's Latin initials. */
  nameEn: string;
  email: string;
  positions: string[];
  /** "Electrical · Tower 2" (gap row 20). */
  visibility: string;
  /** All Trades and all Locations: the summary reads green. */
  visibilityAll: boolean;
};
export type Candidate = { id: string; name: string; nameEn: string; email: string; isMe: boolean };

/**
 * A Participant's Project Members (gap rows 19 to 25): each one's Positions and Visibility.
 * `candidates` (the Company's Members not yet on the Project) is given only to the Authorized
 * Person, who alone adds, removes and gives Positions; anyone else reads the table.
 */
export function ProjectMembersTable({
  participantId,
  project,
  members,
  positions,
  candidates,
}: {
  participantId: string;
  project: string;
  members: MemberRow[];
  positions: Position[];
  candidates: Candidate[] | null;
}) {
  const t = useTranslations("participants");
  const router = useRouter();
  const toast = useToast();
  const handover = useHandover();
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const canManage = candidates !== null;
  const positionName = new Map(positions.map((p) => [p.key, p.name]));
  const memberUrl = (id: string) => `/api/v1/participants/${participantId}/members/${id}`;

  /** A change that may take a Member out of a Step Pool: their Steps there are handed over first (RP-108). */
  function withHandover(change: Pick<HandoverRequest, "action" | "method" | "url" | "body">, done: string, close: () => void) {
    void handover.run({
      ...change,
      done: (outcome) => {
        if (outcome.kind === "done") {
          close();
          toast({ title: done, tone: "success" });
          return router.refresh();
        }
        toast({ title: outcome.kind === "refused" ? outcome.message : t("unavailable"), tone: "danger" });
      },
    });
  }

  return (
    <>
      {members.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-muted">{t("noMembers")}</p>
      ) : (
        <div className="@container rounded-lg border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] gap-4 border-b border-border px-4 py-2.5 text-xs font-semibold text-muted @[1000px]:grid" aria-hidden>
            <span>{t("member")}</span>
            <span>{t("positions")}</span>
            <span>{t("visibility")}</span>
            <span />
          </div>
          <ul className="divide-y divide-border" data-testid="project-members">
            {members.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-1 items-center gap-3 px-4 py-3 @[1000px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] @[1000px]:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} initialsFrom={m.nameEn} solidFrom={m.id} size="lg" decorative />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text">{m.name}</p>
                    <p className="truncate text-sm text-muted">
                      <bdi dir="ltr">{m.email}</bdi>
                    </p>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label={t("positions")}>
                  {m.positions.length === 0 ? (
                    <li className="text-sm text-muted">{t("noPositions")}</li>
                  ) : (
                    m.positions.map((key) => (
                      <li key={key}>
                        <Badge>{positionName.get(key) ?? key}</Badge>
                      </li>
                    ))
                  )}
                </ul>
                <p className={cn("flex items-start gap-1.5 text-sm", m.visibilityAll ? "text-success-fg" : "text-muted")}>
                  <Icon name="eye" size={16} className="mt-0.5 shrink-0" />
                  {/* The header row is for the eye only; a screen reader hears the column here. */}
                  <span>
                    <span className="sr-only">{t("visibility")}: </span>
                    {m.visibility}
                  </span>
                </p>
                <div className="flex items-center gap-1.5 @[1000px]:justify-end">
                  <Link
                    href={`/participants/${participantId}/members/${m.id}/visibility`}
                    aria-label={t("visibilityOf", { name: m.name })}
                    className={outlined}
                  >
                    <Icon name="eye" size={16} />
                    {t("visibility")}
                  </Link>
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="border border-border"
                        aria-label={t("positionsTitle", { name: m.name })}
                        disabled={handover.pending}
                        onClick={() => setEditing(m)}
                      >
                        {t("editPositions")}
                      </Button>
                      <IconButton label={t("removeMember", { name: m.name })} disabled={handover.pending} onClick={() => setRemoving(m)}>
                        <Icon name="trash" size={18} />
                      </IconButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <PositionsDialog
          key={editing.id}
          member={editing}
          project={project}
          positions={positions}
          pending={handover.pending}
          onClose={() => setEditing(null)}
          onSave={(next) =>
            withHandover({ action: "save", method: "PUT", url: `${memberUrl(editing.id)}/positions`, body: { positions: next } }, t("positionsSaved"), () => setEditing(null))
          }
        />
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing && (
          <DialogContent className={sheetOnPhone} closeLabel={t("close")} title={t("removeTitle", { name: removing.name, project })} description={t("removeBody")}>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t("cancel")}</Button>
              </DialogClose>
              <Button
                variant="danger"
                disabled={handover.pending}
                onClick={() =>
                  withHandover({ action: "remove", method: "DELETE", url: memberUrl(removing.id), body: {} }, t("removed", { name: removing.name, project }), () => setRemoving(null))
                }
              >
                {t("remove")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      {handover.dialog}
    </>
  );
}

function PositionsDialog({
  member,
  project,
  positions,
  pending,
  onClose,
  onSave,
}: {
  member: MemberRow;
  project: string;
  positions: Position[];
  pending: boolean;
  onClose: () => void;
  onSave: (positions: string[]) => void;
}) {
  const t = useTranslations("participants");
  const [chosen, setChosen] = useState(() => new Set(member.positions));
  const toggle = (key: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={sheetOnPhone} closeLabel={t("close")} title={t("positionsTitle", { name: member.name })} description={t("positionsHint", { project })}>
        <fieldset className="space-y-2">
          <legend className="sr-only">{t("positions")}</legend>
          {positions.map((p) => (
            <Field key={p.key} label={p.name} layout="inline">
              <Checkbox checked={chosen.has(p.key)} onCheckedChange={(checked) => toggle(p.key, checked === true)} />
            </Field>
          ))}
        </fieldset>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("cancel")}</Button>
          </DialogClose>
          <Button disabled={pending} onClick={() => onSave(positions.filter((p) => chosen.has(p.key)).map((p) => p.key))}>
            {t("savePositions")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Add a Member of your Company" (gap row 23): a Member of the Company not on the Project yet,
 * and one Position. They start with all of the Company's Visibility (gap row 24).
 */
export function AddMemberDialog({
  participantId,
  project,
  positions,
  candidates,
}: {
  participantId: string;
  project: string;
  positions: Position[];
  candidates: Candidate[];
}) {
  const t = useTranslations("participants");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [position, setPosition] = useState(positions[0]?.key ?? "");
  const [pending, setPending] = useState(false);

  async function add() {
    const who = candidates.find((c) => c.id === memberId);
    if (!who) return;
    setPending(true);
    try {
      const base = `/api/v1/participants/${participantId}/members`;
      const added = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: who.id }) });
      if (!added.ok) return toast({ title: t("unavailable"), tone: "danger" });
      // A new Project Member holds no Step, so giving the Position never needs a Handover.
      const placed =
        !position ||
        (
          await fetch(`${base}/${who.id}/positions`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ positions: [position] }),
          })
        ).ok;
      setOpen(false);
      setMemberId(null);
      // Added either way; a Position that didn't save is given from the row's Positions button.
      toast(
        placed
          ? { title: t("added", { name: who.name, project }), tone: "success" }
          : { title: t("added", { name: who.name, project }), description: t("positionNotSaved"), tone: "danger" },
      );
      router.refresh();
    } catch {
      toast({ title: t("unavailable"), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Icon name="person-add" size={16} />
        {t("addTitle")}
      </Button>
      <DialogContent className={sheetOnPhone} closeLabel={t("close")} title={t("addTitle")} description={t("addHint")}>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted">{t("noCandidates")}</p>
        ) : (
          <div className="space-y-4">
            <fieldset className="max-h-60 space-y-2 overflow-y-auto">
              <legend className="mb-1.5 text-sm text-muted">{t("member")}</legend>
              {candidates.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5",
                    memberId === c.id ? "border-primary bg-brand-tint" : "border-border hover:bg-hover",
                  )}
                >
                  <input type="radio" name="memberId" value={c.id} checked={memberId === c.id} onChange={() => setMemberId(c.id)} className="size-4 accent-primary" />
                  <Avatar name={c.name} initialsFrom={c.nameEn} solidFrom={c.id} decorative />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">
                      {c.name}
                      {c.isMe && ` ${t("you")}`}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      <bdi dir="ltr">{c.email}</bdi>
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {positions.length > 0 && (
              <Field label={t("position")} id="add-member-position">
                <Select value={position} onValueChange={setPosition} options={positions.map((p) => ({ value: p.key, label: p.name }))} />
              </Field>
            )}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("cancel")}</Button>
          </DialogClose>
          <Button disabled={pending || memberId === null} onClick={() => void add()}>
            {t("addToProject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
