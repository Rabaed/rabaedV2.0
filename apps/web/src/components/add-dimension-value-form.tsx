"use client";

import type { DimensionKind } from "@rabaed/domain";
import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

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
          ...(kind === "location" ? { parentId: form.get("parentId") || null } : {}),
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
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={id("parent")}>{t("parent")}</Label>
          <select
            id={id("parent")}
            name="parentId"
            defaultValue=""
            className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm"
          >
            <option value="">{t("newZone")}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={id("nameEn")}>{t("nameEn")}</Label>
        <Input id={id("nameEn")} name="nameEn" dir="ltr" required maxLength={200} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id("nameAr")}>{t("nameAr")}</Label>
        <Input id={id("nameAr")} name="nameAr" dir="rtl" required maxLength={200} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id("code")}>{t("code")}</Label>
        <Input id={id("code")} name="code" dir="ltr" required maxLength={6} aria-describedby={id("codeHint")} />
        <p id={id("codeHint")} className="text-sm text-muted">
          {t("codeHint")}
        </p>
      </div>
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
