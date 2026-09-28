"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

export function SignOutButton() {
  const t = useTranslations("shell");
  const router = useRouter();

  async function signOut() {
    await fetch("/api/v1/session", { method: "DELETE" });
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut}>
      {t("signOut")}
    </Button>
  );
}
