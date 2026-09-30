"use client";

import { useTranslations } from "next-intl";
import { Field, Input } from "@rabaed/ui";

/** An invitation link, shown once for the Authorized Person to pass on (until email delivery exists). */
export function InvitationLink({ id, link }: { id: string; link: string }) {
  const t = useTranslations("members");
  return (
    <div data-testid="invitation-link">
      <Field label={t("invitationLink")} id={id} readOnly>
        <Input value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
      </Field>
    </div>
  );
}
