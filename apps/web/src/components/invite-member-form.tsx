"use client";

import type { Locale } from "@rabaed/domain";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Select } from "@rabaed/ui";
import { InvitationLink } from "@/components/invitation-link";
import { useRouter } from "@/i18n/navigation";
import { invitationLink, requestReactivation } from "@/lib/member-invitations";

/**
 * The Authorized Person invites a Member (the form, shown by `InviteMemberDialog`). Until email delivery exists, the
 * invitation link is shown once here for them to pass on. A taken email is
 * answered as visibility.md V17 says: another Company is never named, and a
 * deactivated Member of their own Company is reactivated once they confirm.
 */
export function InviteMemberForm() {
  const t = useTranslations("members");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    setLink(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          fullName: { en: form.get("nameEn"), ar: form.get("nameAr") },
          locale: form.get("locale"),
        }),
      });
      if (res.status === 201) {
        const { invitation } = (await res.json()) as { invitation: { token: string } };
        setLink(invitationLink(form.get("locale") as Locale, invitation.token));
        formElement.reset();
        router.refresh();
        return;
      }
      if (res.status !== 409) return setError(res.status === 400 ? t("invalid") : t("unavailable"));
      const refused = (await res.json()) as { error: string; memberId?: string };
      if (refused.error === "already_a_member") return setError(t("alreadyAMember"));
      if (refused.error === "registered_with_another_company") return setError(t("registeredWithAnotherCompany"));
      if (refused.error !== "deactivated_member" || !refused.memberId) return setError(t("unavailable"));
      if (!window.confirm(t("confirmReactivateEmail", { email: String(form.get("email")).trim() }))) return;
      const reactivated = await requestReactivation(refused.memberId);
      if (reactivated.link) setLink(reactivated.link);
      else setNotice(t("reactivated"));
      formElement.reset();
      router.refresh();
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t("email")} id="invite-email" required className="sm:col-span-2">
          <Input name="email" type="email" autoComplete="off" dir="ltr" />
        </Field>
        <Field label={t("nameEn")} id="invite-name-en" required>
          <Input name="nameEn" dir="ltr" lang="en" />
        </Field>
        <Field label={t("nameAr")} id="invite-name-ar" required>
          <Input name="nameAr" dir="rtl" lang="ar" />
        </Field>
        <Field label={t("language")} id="invite-locale">
          {/* Each language named in itself. */}
          <Select
            name="locale"
            defaultValue={locale}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
            ]}
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {t("invite")}
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {link && <InvitationLink id="invitation-link" link={link} />}
    </div>
  );
}
