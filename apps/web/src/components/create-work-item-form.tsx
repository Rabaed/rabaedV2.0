"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

type Option = { id: string; label: string };

const selectClass = "h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm";

/** Creates a MAR in Draft, then opens it. */
export function CreateWorkItemForm({
  projectId,
  trades,
  locations,
}: {
  projectId: string;
  trades: Option[];
  locations: Option[];
}) {
  const t = useTranslations("workItems");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "MAR",
          title: form.get("title"),
          tradeId: form.get("tradeId"),
          locationId: form.get("locationId") || null,
          description: form.get("description"),
        }),
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/work-items/${id}`);
        return;
      }
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        forbidden: t("notContractor"),
        outside_visibility: t("outsideVisibility"),
        project_closed: t("projectClosed"),
      };
      setError(errors[code ?? ""] ?? t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="title">{t("fields.title")}</Label>
        <Input id="title" name="title" required maxLength={200} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tradeId">{t("fields.trade")}</Label>
          <select id="tradeId" name="tradeId" required defaultValue={trades[0]?.id} className={selectClass}>
            {trades.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="locationId">{t("fields.location")}</Label>
          <select id="locationId" name="locationId" defaultValue="" className={selectClass}>
            <option value="">{t("noLocation")}</option>
            {locations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">{t("fields.description")}</Label>
        <textarea
          id="description"
          name="description"
          rows={5}
          maxLength={4000}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("saveDraft")}
      </Button>
    </form>
  );
}
