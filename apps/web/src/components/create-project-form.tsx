"use client";

import { baseRoles } from "@rabaed/domain";
import { Button, Field, Input, Select } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
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
        <Field label={t("nameEn")} id="project-name-en" required>
          <Input name="nameEn" dir="ltr" lang="en" />
        </Field>
        <Field label={t("nameAr")} id="project-name-ar" required>
          <Input name="nameAr" dir="rtl" lang="ar" />
        </Field>
        <Field label={t("code")} help={t("codeHint")} id="project-code" required>
          <Input name="code" dir="ltr" minLength={2} maxLength={10} className="uppercase" />
        </Field>
        <Field label={t("role")} id="project-role">
          <Select
            name="role"
            defaultValue="contractor"
            options={baseRoles.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
          />
        </Field>
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
