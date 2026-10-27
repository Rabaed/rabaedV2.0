"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, Field, Icon, IconButton, Input, type IconName } from "@rabaed/ui";
import { useRouter } from "@/i18n/navigation";
import { browserLanguage } from "@/lib/browser-locale";

// The owner's design (RP-1057): 46px fields with a leading icon, 11–12px corners.
const tall = "h-11.5 rounded-md ps-10.5 text-[14.5px]";

function LeadingIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-faint" />;
}

export function SignInForm() {
  const t = useTranslations("signIn");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), locale: browserLanguage(locale) }),
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
      {error && (
        <p role="alert" className="flex items-start gap-2.5 rounded-md bg-danger-tint px-3.5 py-3 text-sm text-danger-fg">
          <Icon name="alert-circle" size={18} className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <Field label={t("email")} id="email">
        <div className="relative">
          <LeadingIcon name="mail" />
          <Input
            name="email"
            type="email"
            autoComplete="username"
            dir="ltr"
            required
            placeholder={t("emailPlaceholder")}
            // An LTR address in an RTL page keeps the icon's side free and reads from the start.
            className={`${tall} rtl:pe-10.5 rtl:ps-3.5 rtl:text-end`}
          />
        </div>
      </Field>
      <Field label={t("password")} id="password">
        <div className="relative">
          <LeadingIcon name="lock" />
          <Input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${tall} pe-11.5`}
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
      <Button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="h-11.5 w-full rounded-md text-[14.5px] font-semibold disabled:bg-primary disabled:text-on-primary disabled:opacity-70"
      >
        {pending && <span aria-hidden="true" className="size-4.5 animate-spin rounded-full border-2 border-on-primary/40 border-t-on-primary" />}
        {t("submit")}
      </Button>
    </form>
  );
}
