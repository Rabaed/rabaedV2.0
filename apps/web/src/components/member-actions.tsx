"use client";

import type { CompanyMember, Locale } from "@rabaed/domain";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@rabaed/ui";
import { useHandover } from "@/components/handover";
import { InvitationLink } from "@/components/invitation-link";
import { useRouter } from "@/i18n/navigation";
import { requestReactivation } from "@/lib/member-invitations";

/** The Authorized Person's buttons on one row of the Members list. */
export function MemberActions({ member }: { member: CompanyMember }) {
  const t = useTranslations("members");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function send(path: string, method: "PATCH" | "POST", body?: unknown) {
    setPending(true);
    setError(false);
    setRefusal(null);
    try {
      const res = await fetch(`/api/v1/members/${member.id}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) return setError(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  // Deactivating hands every open Step they hold over first (RP-108).
  const handover = useHandover();

  function deactivate() {
    if (!window.confirm(t("confirmDeactivate", { name: member.fullName[locale] }))) return;
    setError(false);
    setRefusal(null);
    void handover.run({
      name: member.fullName[locale],
      change: "deactivate",
      send: (handovers) =>
        fetch(`/api/v1/members/${member.id}/deactivate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(handovers ? { handovers } : {}),
        }),
      done: (outcome) => {
        if (outcome.ok) return router.refresh();
        // Nobody else can take one of their Steps: that says which; anything else, the usual.
        if ("message" in outcome) setRefusal(outcome.message);
        else setError(true);
      },
    });
  }

  async function reactivate() {
    if (!window.confirm(t("confirmReactivate", { name: member.fullName[locale] }))) return;
    setPending(true);
    setError(false);
    try {
      setLink((await requestReactivation(member.id)).link);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  const failed = (error || refusal) && (
    <span role="alert" className="text-sm text-danger">
      {refusal ?? t("unavailable")}
    </span>
  );

  // Reactivated just now, never having accepted their first invitation: the new one, shown once.
  if (link) return <InvitationLink id={`invitation-link-${member.id}`} link={link} />;

  if (member.status === "deactivated") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={reactivate}>
          {t("reactivate")}
        </Button>
        {failed}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => send("", "PATCH", { canCreateProjects: !member.canCreateProjects })}
      >
        {member.canCreateProjects ? t("removeProjectCreator") : t("makeProjectCreator")}
      </Button>
      {!member.isAuthorizedPerson && (
        <Button variant="ghost" size="sm" className="text-danger" disabled={pending || handover.pending} onClick={deactivate}>
          {t("deactivate")}
        </Button>
      )}
      {failed}
      {handover.dialog}
    </div>
  );
}
