"use client";

import type { CompanyMember, Locale } from "@rabaed/domain";
import { Button, Dialog, DialogClose, DialogContent, DialogFooter, RowActionsMenu, useToast, type RowActionsItem } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { InvitationLink } from "@/components/invitation-link";
import { useRouter } from "@/i18n/navigation";
import { requestReactivation } from "@/lib/member-invitations";

type Asking = "deactivate" | "reactivate" | "link";

/**
 * The Authorized Person's commands on one row of the Members list: a "⋯" menu with
 * Make or Remove Project Creator, Deactivate (after a confirmation) or, for a
 * deactivated Member, Reactivate (also confirmed). A Member who never accepted
 * their first invitation gets a new one when reactivated, shown once.
 */
export function MemberActions({ member }: { member: CompanyMember }) {
  const t = useTranslations("members");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const name = member.fullName[locale];
  const [asking, setAsking] = useState<Asking | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const failed = () => {
    setError(true);
    toast({ title: t("unavailable"), tone: "danger" });
  };
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
      if (!res.ok) return failed();
      setAsking(null);
      toast({ title: t("saved", { name }), tone: "success" });
      router.refresh();
    } catch {
      failed();
    } finally {
      setPending(false);
    }
  }

  async function reactivate() {
    setPending(true);
    setError(false);
    try {
      const { link: invitation } = await requestReactivation(member.id);
      router.refresh();
      toast({ title: t("saved", { name }), tone: "success" });
      // Never accepted their first invitation: the new one, shown once.
      setAsking(invitation ? "link" : null);
      setLink(invitation ?? null);
    } catch {
      failed();
    } finally {
      setPending(false);
    }
  }

  const items: RowActionsItem[] =
    member.status === "deactivated"
      ? [{ key: "reactivate", icon: "refresh" as const, label: t("reactivate"), onSelect: () => setAsking("reactivate") }]
      : [
          {
            key: "creator",
            icon: member.canCreateProjects ? ("circle-x" as const) : ("person-add" as const),
            label: member.canCreateProjects ? t("removeProjectCreator") : t("makeProjectCreator"),
            onSelect: () => void send("", "PATCH", { canCreateProjects: !member.canCreateProjects }),
          },
          ...(member.isAuthorizedPerson
            ? []
            : [{ key: "deactivate", icon: "logout" as const, label: t("deactivate"), tone: "danger" as const, onSelect: () => setAsking("deactivate") }]),
        ];

  const confirming = asking === "deactivate" || asking === "reactivate";

  return (
    <div className="flex items-center justify-end gap-2">
      <RowActionsMenu label={t("menuFor", { name })} items={items} busy={pending} />
      <Dialog open={asking !== null} onOpenChange={(open) => !open && !pending && setAsking(null)}>
        <DialogContent
          title={asking === "link" ? t("linkTitle") : asking === "reactivate" ? t("reactivateTitle") : t("deactivateTitle")}
          description={
            asking === "link" ? undefined : t(asking === "reactivate" ? "confirmReactivate" : "confirmDeactivate", { name })
          }
          closeLabel={t("close")}
        >
          {asking === "link" && link && <InvitationLink id={`invitation-link-${member.id}`} link={link} />}
          {confirming && error && (
            <p role="alert" className="text-sm text-danger-fg">
              {t("unavailable")}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={pending}>
                {asking === "link" ? t("close") : t("cancel")}
              </Button>
            </DialogClose>
            {confirming && (
              <Button
                variant={asking === "deactivate" ? "danger" : "primary"}
                disabled={pending}
                onClick={() => (asking === "deactivate" ? void send("/deactivate", "POST") : void reactivate())}
              >
                {asking === "deactivate" ? t("deactivate") : t("reactivate")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
