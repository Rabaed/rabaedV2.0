"use client";

import { baseRoles } from "@rabaed/domain";
import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

/** A Project Creator creates a Project; their Company joins it in the chosen Project Role. */
export function CreateProjectForm() {
  const t = useTranslations("projects");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: { en: form.get("nameEn"), ar: form.get("nameAr") },
          code: form.get("code"),
          role: form.get("role"),
        }),
      });
      if (res.status === 201) {
        const { projectId } = (await res.json()) as { projectId: string };
        router.push(`/projects/${projectId}`);
        router.refresh();
        return;
      }
      setError(res.status === 400 ? t("invalid") : res.status === 403 ? t("notCreator") : t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <h2 className="text-h6 font-semibold">{t("createTitle")}</h2>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="space-y-2">
          <Label htmlFor="project-name-en">{t("nameEn")}</Label>
          <Input id="project-name-en" name="nameEn" dir="ltr" lang="en" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-name-ar">{t("nameAr")}</Label>
          <Input id="project-name-ar" name="nameAr" dir="rtl" lang="ar" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-code">{t("code")}</Label>
          <Input
            id="project-code"
            name="code"
            dir="ltr"
            required
            minLength={2}
            maxLength={10}
            className="uppercase"
            aria-describedby="project-code-hint"
          />
          <p id="project-code-hint" className="text-sm text-muted">
            {t("codeHint")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-role">{t("role")}</Label>
          <select
            id="project-role"
            name="role"
            defaultValue="contractor"
            className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm"
          >
            {baseRoles.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {t("create")}
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
