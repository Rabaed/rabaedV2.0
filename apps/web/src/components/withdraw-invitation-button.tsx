"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * The Project Admin withdraws a pending invitation. It works the same whether
 * the CR number is on Rabaed or not, and says nothing about which (ADR 0009).
 */
export function WithdrawInvitationButton({ projectId, invitationId }: { projectId: string; invitationId: string }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function withdraw() {
    if (!window.confirm(t("confirmWithdraw"))) return;
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/invitations/${invitationId}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return setError(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" disabled={pending} onClick={withdraw}>
        {t("withdraw")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {t("unavailable")}
        </span>
      )}
    </span>
  );
}
