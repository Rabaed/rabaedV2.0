"use client";

import type { CompanyMember, Locale } from "@rabaed/domain";
import { Button, Dialog, DialogClose, DialogContent, DialogFooter, RowActionsMenu, useToast, type RowActionsItem } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useHandover } from "@/components/handover";
import { useRouter } from "@/i18n/navigation";
import { requestReactivation } from "@/lib/member-invitations";

type Asking = "deactivate" | "reactivate";

/**
 * The Authorized Person's commands on one row of the Members list: a "⋯" menu with
 * Make or Remove Project Creator, Deactivate (after a confirmation, then a Handover
 * of every open Step they hold, RP-108) or, for a deactivated Member, Reactivate
 * (also confirmed). A Member who never accepted their first invitation is emailed a
 * new one when reactivated (RP-1052).
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
  const failed = (message?: string) => {
    setError(true);
    toast({ title: message ?? t("unavailable"), tone: "danger" });
  };

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

  // Deactivating hands every open Step they hold over first (RP-108): the Handover dialog
  // asks who takes each when the API lists them.
  const handover = useHandover();

  function deactivate() {
    setError(false);
    setAsking(null);
    void handover.run({
      action: "deactivate",
      method: "POST",
      url: `/api/v1/members/${member.id}/deactivate`,
      body: {},
      done: (outcome) => {
        if (outcome.kind === "done") {
          toast({ title: t("saved", { name }), tone: "success" });
          return router.refresh();
        }
        // Nobody else can take one of their Steps: that says which; anything else, the usual.
        failed(outcome.kind === "refused" ? outcome.message : undefined);
      },
    });
  }

  async function reactivate() {
    setPending(true);
    setError(false);
    try {
      const { invitationSentTo } = await requestReactivation(member.id);
      router.refresh();
      // Never accepted their first invitation: a new one was emailed to them.
      toast({ title: invitationSentTo ? t("invitationSent", { email: invitationSentTo }) : t("saved", { name }), tone: "success" });
      setAsking(null);
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

  return (
    <div className="flex items-center justify-end gap-2">
      <RowActionsMenu label={t("menuFor", { name })} items={items} busy={pending || handover.pending} />
      <Dialog open={asking !== null} onOpenChange={(open) => !open && !pending && setAsking(null)}>
        <DialogContent
          title={asking === "reactivate" ? t("reactivateTitle") : t("deactivateTitle")}
          description={t(asking === "reactivate" ? "confirmReactivate" : "confirmDeactivate", { name })}
          closeLabel={t("close")}
        >
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {t("unavailable")}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={pending}>
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              variant={asking === "deactivate" ? "danger" : "primary"}
              disabled={pending || handover.pending}
              onClick={() => (asking === "deactivate" ? deactivate() : void reactivate())}
            >
              {asking === "deactivate" ? t("deactivate") : t("reactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {handover.dialog}
    </div>
  );
}
