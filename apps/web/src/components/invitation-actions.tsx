"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/** The Authorized Person accepts or declines a Participant Invitation for their Company. */
export function InvitationActions({ invitationId }: { invitationId: string }) {
  const t = useTranslations("participants");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function answer(to: "accept" | "decline") {
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/v1/participant-invitations/${invitationId}/${to}`, {
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

  function decline() {
    if (window.confirm(t("confirmDecline"))) void answer("decline");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => answer("accept")}>
        {t("accept")}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={decline}>
        {t("decline")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-danger-fg">
          {t("unavailable")}
        </span>
      )}
    </div>
  );
}
