"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@rabaed/ui";
import { useRouter } from "@/i18n/navigation";

export function SignInForm() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
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
    <form onSubmit={onSubmit} className="max-w-sm space-y-4" noValidate>
      <Field label={t("email")} id="email" required>
        <Input name="email" type="email" autoComplete="username" dir="ltr" />
      </Field>
      <Field label={t("password")} id="password" required>
        <Input name="password" type="password" autoComplete="current-password" />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
