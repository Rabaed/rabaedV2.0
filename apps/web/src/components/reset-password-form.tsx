"use client";

import { PASSWORD_MIN_LENGTH as MIN_PASSWORD } from "@rabaed/domain";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { buttonVariants, cn, Field, Input } from "@rabaed/ui";
import { FormAlert, LeadingIcon, SubmitButton, tallButton, tallInput } from "@/components/sign-in-fields";
import { Link, useRouter } from "@/i18n/navigation";
import { tokenFromHash } from "@/lib/link-token";
import { memberLanguage } from "@/lib/member-language";

/** One plain message for an expired, used or made-up link, with the way to ask for a new one. */
function ExpiredLink() {
  const t = useTranslations("passwordReset");
  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{t("expired")}</FormAlert>
      <Link href="/forgot-password" className={cn(buttonVariants(), tallButton)}>
        {t("requestNew")}
      </Link>
    </div>
  );
}

/** Sets a new password from the emailed link (RP-1058), then goes home signed in. */
export function ResetPasswordForm() {
  const t = useTranslations("passwordReset");
  const locale = useLocale();
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The fragment exists only in the browser, so read it after hydration; then take it out of the
  // address bar, so the token isn't left in the browser's history.
  // A second run (React's development double run) finds the hash gone and keeps the token read first.
  useEffect(() => {
    const found = tokenFromHash();
    if (!found) return setToken((read) => (read === undefined ? null : read));
    setToken(found);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < MIN_PASSWORD) return setError(t("tooShort", { min: MIN_PASSWORD }));
    if (password !== form.get("confirm")) return setError(t("mismatch"));
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/password-resets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        router.replace("/", { locale: await memberLanguage(locale) });
        router.refresh();
        return;
      }
      if (res.status === 400 && ((await res.json().catch(() => null)) as { error?: string } | null)?.error === "invalid_reset_link") return setExpired(true);
      setError(t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  if (token === undefined) return null;
  if (!token || expired) return <ExpiredLink />;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <FormAlert>{error}</FormAlert>}
      <Field label={t("password")} help={t("hint", { min: MIN_PASSWORD })} id="password">
        <div className="relative">
          <LeadingIcon name="lock" />
          <Input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required className={tallInput} />
        </div>
      </Field>
      <Field label={t("confirm")} id="confirm">
        <div className="relative">
          <LeadingIcon name="lock" />
          <Input name="confirm" type="password" autoComplete="new-password" required className={tallInput} />
        </div>
      </Field>
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
    </form>
  );
}
