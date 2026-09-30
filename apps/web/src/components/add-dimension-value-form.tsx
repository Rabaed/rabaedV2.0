"use client";

import type { DimensionKind } from "@rabaed/domain";
import { Button, Field, Input, Select } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

// A choice can't have an empty value, so "no parent" (a new Zone) has its own.
const NO_PARENT = "none";

/**
 * A Project Admin adds a Trade, or a Location: a Zone, or a Building or Floor
 * inside one of `parents` (the Zones and Buildings).
 */
export function AddDimensionValueForm({
  projectId,
  kind,
  parents = [],
}: {
  projectId: string;
  kind: DimensionKind;
  parents?: { id: string; label: string }[];
}) {
  const t = useTranslations("dimensions");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = (field: string) => `${kind}-${field}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/${kind}s`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"),
          name: { en: form.get("nameEn"), ar: form.get("nameAr") },
          ...(kind === "location" ? { parentId: form.get("parentId") === NO_PARENT ? null : form.get("parentId") } : {}),
        }),
      });
      if (res.status === 201) {
        formElement.reset();
        router.refresh();
        return;
      }
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        forbidden: t("notAdmin"),
        duplicate_code: t("duplicateCode"),
        project_closed: t("projectClosed"),
        too_deep: t("tooDeep"),
      };
      setError(errors[code ?? ""] ?? t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2" noValidate>
      {kind === "location" && (
        <Field label={t("parent")} id={id("parent")} className="sm:col-span-2">
          <Select
            name="parentId"
            defaultValue={NO_PARENT}
            options={[{ value: NO_PARENT, label: t("newZone") }, ...parents.map((p) => ({ value: p.id, label: p.label }))]}
          />
        </Field>
      )}
      <Field label={t("nameEn")} id={id("nameEn")} required>
        <Input name="nameEn" dir="ltr" maxLength={200} />
      </Field>
      <Field label={t("nameAr")} id={id("nameAr")} required>
        <Input name="nameAr" dir="rtl" maxLength={200} />
      </Field>
      <Field label={t("code")} help={t("codeHint")} id={id("code")} required>
        <Input name="code" dir="ltr" maxLength={6} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {t(kind === "trade" ? "addTrade" : "addLocation")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
