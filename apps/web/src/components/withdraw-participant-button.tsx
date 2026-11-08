"use client";

import type { Locale, ParticipantWithdrawalPreview } from "@rabaed/domain";
import { Button, useToast, WithdrawParticipantDialog } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * The Host Company's Project Admin withdraws a Participant (RP-952, ADR 0028). The dialog reads
 * the counts first (items to be Cancelled, Steps to become Vacancies) and won't withdraw before
 * they are shown; there is no undo. The page shows this only to the Host Company's Project Admin
 * and never on the Host Company's own row; the API refuses anyone else alike (404).
 */
export function WithdrawParticipantButton({
  participantId,
  companyName,
  projectName,
  roleName,
}: {
  participantId: string;
  companyName: string;
  projectName: string;
  roleName: string;
}) {
  const t = useTranslations("projects.withdrawParticipant");
  const tProjects = useTranslations("projects");
  const tParticipants = useTranslations("participants");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ParticipantWithdrawalPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/v1/participants/${encodeURIComponent(participantId)}`;

  async function start() {
    setOpen(true);
    setPreview(null);
    setError(null);
    try {
      const res = await fetch(`${url}/withdrawal`);
      if (!res.ok) return setError(tProjects("unavailable"));
      setPreview((await res.json()) as ParticipantWithdrawalPreview);
    } catch {
      setError(tProjects("unavailable"));
    }
  }

  async function withdraw() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${url}/withdraw`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) return setError(tProjects("unavailable"));
      setOpen(false);
      toast({ title: t("done", { company: companyName }), tone: "success" });
      router.refresh();
    } catch {
      setError(tProjects("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="border border-border" aria-label={t("buttonLabel", { company: companyName })} onClick={() => void start()}>
        {t("button")}
      </Button>
      <WithdrawParticipantDialog
        open={open}
        onOpenChange={setOpen}
        companyName={companyName}
        projectName={projectName}
        roleName={roleName}
        preview={preview}
        locale={locale}
        pending={pending}
        error={error}
        onConfirm={() => void withdraw()}
        labels={{
          title: (company, project) => t("title", { company, project }),
          description: t("description"),
          itemsToCancel: (n, count) => t("itemsToCancel", { n, count }),
          stepsToVacate: (n, count, role) => t("stepsToVacate", { n, count, role }),
          countsInclude: t("countsInclude"),
          noUndo: t("noUndo"),
          comeBack: t("comeBack"),
          counting: t("counting"),
          cancel: tParticipants("cancel"),
          confirm: t("confirm"),
          close: tProjects("close"),
        }}
      />
    </>
  );
}
