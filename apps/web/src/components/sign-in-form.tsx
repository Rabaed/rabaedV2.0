"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Field, Icon, IconButton, Input } from "@rabaed/ui";
import { emailInput, FormAlert, LeadingIcon, signInLink, SubmitButton, tallInput } from "@/components/sign-in-fields";
import { Link, useRouter } from "@/i18n/navigation";
import { browserLanguage } from "@/lib/browser-locale";
import { signInFieldError } from "@/lib/sign-in-check";

export function SignInForm() {
  const t = useTranslations("signIn");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<"email" | "password" | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(null);
    // The design checks the fields before sending: a malformed email, then an empty password.
    const invalid = signInFieldError({ email, password });
    setFieldError(invalid);
    if (invalid) {
      formElement.querySelector<HTMLInputElement>(`input[name="${invalid}"]`)?.focus();
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, locale: browserLanguage(locale) }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      // One message for every failure: the API never says which part was wrong.
      setError(res.status === 401 || res.status === 400 ? t("invalid") : t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <FormAlert>{error}</FormAlert>}
      <Field label={t("email")} id="email" error={fieldError === "email" ? t("emailMissing") : undefined}>
        <div className="relative">
          <LeadingIcon name="mail" />
          <Input name="email" type="email" autoComplete="username" dir="ltr" required placeholder={t("emailPlaceholder")} className={emailInput} />
        </div>
      </Field>
      {/* The design puts "Forgot password?" at the end of the password's label row (RP-1058). */}
      <div className="relative">
        <Field label={t("password")} id="password" error={fieldError === "password" ? t("passwordMissing") : undefined}>
          <div className="relative">
            <LeadingIcon name="lock" />
            <Input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className={`${tallInput} pe-11.5`}
            />
            <IconButton
              label={showPassword ? t("hidePassword") : t("showPassword")}
              size="sm"
              className="absolute end-1.5 top-1/2 -translate-y-1/2 text-muted"
              onClick={() => setShowPassword((shown) => !shown)}
            >
              <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
            </IconButton>
          </div>
        </Field>
        <Link href="/forgot-password" className={`absolute end-0 top-0 text-[13px] ${signInLink}`}>
          {t("forgot")}
        </Link>
      </div>
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
    </form>
  );
}
