"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Select } from "@rabaed/ui";
import { useRouter } from "@/i18n/navigation";

/**
 * The Authorized Person invites a Member. Until email delivery exists, the
 * invitation link is shown once here for them to pass on. The token travels in
 * the URL fragment, which browsers never send to a server.
 */
export function InviteMemberForm() {
  const t = useTranslations("members");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    setLink(null);
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
        const inviteeLocale = String(form.get("locale"));
        setLink(`${window.location.origin}/${inviteeLocale}/accept-invitation#token=${invitation.token}`);
        formElement.reset();
        router.refresh();
        return;
      }
      setError(res.status === 409 ? t("duplicateEmail") : res.status === 400 ? t("invalid") : t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <h2 className="text-h6 font-semibold">{t("inviteTitle")}</h2>
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
      {link && (
        <div data-testid="invitation-link">
          <Field label={t("invitationLink")} id="invitation-link" readOnly>
            <Input value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </div>
      )}
    </section>
  );
}
