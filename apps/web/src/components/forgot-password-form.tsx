"use client";

import { PASSWORD_RESET } from "@rabaed/domain";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Field, Input } from "@rabaed/ui";
import { emailInput, FormAlert, LeadingIcon, SubmitButton } from "@/components/sign-in-fields";

/**
 * Asks for a reset link (RP-1058). The api gives every email the same answer, so the page does too:
 * "if this email belongs to a Member, we've sent a link". Only too many requests is told apart.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("passwordReset");
  const signIn = useTranslations("signIn");
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("pending");
    setError(null);
    try {
      const res = await fetch("/api/v1/password-resets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      if (res.ok) return setState("sent");
      // A malformed email is the one thing the page can say without telling whether it is registered.
      setError(res.status === 429 ? t("tooMany") : res.status === 400 ? signIn("invalid") : t("unavailable"));
    } catch {
      setError(t("unavailable"));
    }
    setState("idle");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {state === "sent" && <FormAlert tone="success">{t("sent", { minutes: String(PASSWORD_RESET.validMinutes) })}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
      <Field label={signIn("email")} id="email">
        <div className="relative">
          <LeadingIcon name="mail" />
          <Input name="email" type="email" autoComplete="email" dir="ltr" required placeholder={signIn("emailPlaceholder")} className={emailInput} />
        </div>
      </Field>
      <SubmitButton pending={state === "pending"}>{t("send")}</SubmitButton>
    </form>
  );
}
