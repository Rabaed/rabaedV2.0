"use client";

import type { CompanyMember, Locale } from "@rabaed/domain";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@rabaed/ui";
import { InvitationLink } from "@/components/invitation-link";
import { useRouter } from "@/i18n/navigation";
import { reactivateMember } from "@/lib/member-invitations";

/** The Authorized Person's buttons on one row of the Members list. */
export function MemberActions({ member }: { member: CompanyMember }) {
  const t = useTranslations("members");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function send(path: string, method: "PATCH" | "POST", body?: unknown) {
    setPending(true);
    setError(false);
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

  function deactivate() {
    if (window.confirm(t("confirmDeactivate", { name: member.fullName[locale] }))) void send("/deactivate", "POST");
  }

  async function reactivate() {
    if (!window.confirm(t("confirmReactivate", { name: member.fullName[locale] }))) return;
    setPending(true);
    setError(false);
    try {
      setLink((await reactivateMember(member.id)).link);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  const failed = error && (
    <span role="alert" className="text-sm text-danger">
      {t("unavailable")}
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
        <Button variant="ghost" size="sm" className="text-danger" disabled={pending} onClick={deactivate}>
          {t("deactivate")}
        </Button>
      )}
      {failed}
    </div>
  );
}
