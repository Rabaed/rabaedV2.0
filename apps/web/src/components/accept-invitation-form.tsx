"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

const MIN_PASSWORD = 12;

/**
 * The invitation link carries its token in the URL fragment (#token=…), which
 * browsers never send to a server or in a Referer header.
 */
function tokenFromHash(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

export function AcceptInvitationForm() {
  const t = useTranslations("acceptInvitation");
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The fragment exists only in the browser, so read it after hydration.
  useEffect(() => setToken(tokenFromHash()), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < MIN_PASSWORD) return setError(t("tooShort", { min: MIN_PASSWORD }));
    if (password !== form.get("confirm")) return setError(t("mismatch"));
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError(res.status === 400 ? t("invalid") : t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  if (token === undefined) return null;
  if (!token) {
    return (
      <p role="alert" className="text-danger">
        {t("invalid")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4" noValidate>
      <p className="text-sm text-muted-foreground">{t("hint", { min: MIN_PASSWORD })}</p>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
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
