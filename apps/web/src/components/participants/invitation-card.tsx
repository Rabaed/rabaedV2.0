"use client";

import { Badge, Button, Dialog, DialogClose, DialogContent, DialogFooter, Icon, useToast } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

export type InvitationCardProps = {
  id: string;
  project: string;
  host: string;
  /** The viewer's own Company. */
  company: string;
  role: string;
  /** "2 days ago", from when it was sent. */
  ago: string;
};

/**
 * A pending Participant Invitation, for the Authorized Person: only the Project's name, its Host
 * Company and the offered Project Role until it is accepted (ADR 0009). Decline asks first.
 */
export function InvitationCard({ id, project, host, company, role, ago }: InvitationCardProps) {
  const t = useTranslations("participants");
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [declining, setDeclining] = useState(false);

  async function answer(to: "accept" | "decline") {
    setPending(true);
    try {
      const res = await fetch(`/api/v1/participant-invitations/${id}/${to}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return toast({ title: t("unavailable"), tone: "danger" });
      setDeclining(false);
      toast(
        to === "accept"
          ? { title: t("joined", { project }), description: t("joinedNext"), tone: "success" }
          : { title: t("declined"), tone: "info" },
      );
      router.refresh();
    } catch {
      toast({ title: t("unavailable"), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-md border border-brand-tint bg-brand-tint px-4 py-3.5 max-sm:flex-col max-sm:items-stretch">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-brand-fg max-sm:hidden">
        <Icon name="mail" size={18} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-text">{project}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {t("invitedToJoin", { host, company })}
          <Badge className="bg-surface">{role}</Badge>
          <span>· {ago}</span>
        </p>
      </div>
      <div className="flex gap-2 max-sm:[&>*]:flex-1">
        <Button variant="secondary" disabled={pending} onClick={() => setDeclining(true)}>
          {t("decline")}
        </Button>
        <Button disabled={pending} onClick={() => void answer("accept")}>
          <Icon name="check" size={16} />
          {t("accept")}
        </Button>
      </div>
      <Dialog open={declining} onOpenChange={setDeclining}>
        <DialogContent closeLabel={t("close")} title={t("declineTitle")} description={t("declineBody", { company, project, host })}>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("keepInvitation")}</Button>
            </DialogClose>
            <Button variant="danger" disabled={pending} onClick={() => void answer("decline")}>
              {t("decline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
