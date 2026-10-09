"use client";

import { Button, Dialog, DialogContent, DialogTrigger, Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { InviteMemberForm } from "@/components/invite-member-form";

/** "Invite Member" for the Authorized Person: the invite form in a dialog, which stays open to show the invitation link once. */
export function InviteMemberDialog() {
  const t = useTranslations("members");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Icon name="plus" size={16} />
          {t("inviteMember")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("inviteTitle")} closeLabel={t("close")}>
        <InviteMemberForm />
      </DialogContent>
    </Dialog>
  );
}
