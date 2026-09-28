"use client";

import type { CompanyMember, Locale } from "@rabaed/domain";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@rabaed/ui";
import { useRouter } from "@/i18n/navigation";

/** The Authorized Person's buttons on one row of the Members list. */
export function MemberActions({ member }: { member: CompanyMember }) {
  const t = useTranslations("members");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  if (member.status === "deactivated") return null;

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
      {error && (
        <span role="alert" className="text-sm text-danger">
          {t("unavailable")}
        </span>
      )}
    </div>
  );
}
