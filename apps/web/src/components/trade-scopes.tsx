"use client";

import type { BilingualText, Locale, Scope } from "@rabaed/domain";
import { Badge, Button, Field, Input, Select } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

// A choice can't have an empty value, so "no parent" (a new Scope) has its own.
const NO_PARENT = "none";

type Send = (path: string, method: "POST" | "PATCH", body: unknown) => Promise<boolean>;

/** Sends a change to the API and refreshes the page; on a refusal, shows why. */
function useScopeCommand() {
  const t = useTranslations("scopes");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send: Send = async (path, method, body) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
        return true;
      }
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        // A Scope or Trade removed from view, or another Project Admin's change.
        not_found: t("notFound"),
        trade_not_found: t("notFound"),
        parent_not_found: t("notFound"),
        parent_deactivated: t("parentDeactivated"),
        project_closed: t("projectClosed"),
      };
      setError(errors[code ?? ""] ?? t("unavailable"));
      return false;
    } catch {
      setError(t("unavailable"));
      return false;
    } finally {
      setPending(false);
    }
  };

  const alert = error && (
    <p role="alert" className="text-sm text-danger-fg">
      {error}
    </p>
  );
  return { send, pending, alert };
}

const nameFrom = (form: FormData): BilingualText => ({
  en: String(form.get("nameEn") ?? ""),
  ar: String(form.get("nameAr") ?? ""),
});

/** The English and Arabic name inputs, read back with `nameFrom`. */
function NameFields({ idPrefix, name }: { idPrefix: string; name?: BilingualText }) {
  const t = useTranslations("scopes");
  return (
    <>
      <Field label={t("nameEn")} id={`${idPrefix}-nameEn`} required>
        <Input name="nameEn" dir="ltr" maxLength={200} defaultValue={name?.en} />
      </Field>
      <Field label={t("nameAr")} id={`${idPrefix}-nameAr`} required>
        <Input name="nameAr" dir="rtl" maxLength={200} defaultValue={name?.ar} />
      </Field>
    </>
  );
}

/** One Scope or Sub-scope; a Project Admin renames, deactivates or reactivates it. */
function ScopeItem({ scope, canEdit }: { scope: Scope & { level: number }; canEdit: boolean }) {
  const t = useTranslations("scopes");
  const locale = useLocale() as Locale;
  const { send, pending, alert } = useScopeCommand();
  const [renaming, setRenaming] = useState(false);

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send(`/scopes/${scope.id}`, "PATCH", { name: nameFrom(new FormData(event.currentTarget)) })) {
      setRenaming(false);
    }
  }

  function setActive(active: boolean) {
    if (!active && !window.confirm(t("confirmDeactivate", { name: scope.name[locale] }))) return;
    void send(`/scopes/${scope.id}`, "PATCH", { active });
  }

  return (
    <li className="space-y-2 py-2" style={{ paddingInlineStart: `${scope.level * 1.5}rem` }} data-testid="scope">
      <div className="flex flex-wrap items-center gap-2">
        <span className={scope.active ? undefined : "text-muted"}>{scope.name[locale]}</span>
        {!scope.active && <Badge>{t("deactivated")}</Badge>}
        {canEdit && !renaming && (
          <span className="ms-auto flex gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
              {t("rename")}
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setActive(!scope.active)}>
              {t(scope.active ? "deactivate" : "reactivate")}
            </Button>
          </span>
        )}
      </div>
      {renaming && (
        <form onSubmit={rename} className="grid gap-4 sm:grid-cols-2" noValidate>
          <NameFields idPrefix={`scope-${scope.id}`} name={scope.name} />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {t("save")}
            </Button>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setRenaming(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
      {alert}
    </li>
  );
}

/** A Project Admin adds a Scope under the Trade, or a Sub-scope under one of its active Scopes. */
function AddScopeForm({ projectId, tradeId, parents }: { projectId: string; tradeId: string; parents: Scope[] }) {
  const t = useTranslations("scopes");
  const locale = useLocale() as Locale;
  const { send, pending, alert } = useScopeCommand();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const parentId = form.get("parentId");
    const added = await send(`/projects/${projectId}/scopes`, "POST", {
      tradeId,
      parentId: parentId === NO_PARENT ? null : parentId,
      name: nameFrom(form),
    });
    if (added) formElement.reset();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2" noValidate>
      {parents.length > 0 && (
        <Field label={t("parent")} id={`add-scope-${tradeId}-parent`} className="sm:col-span-2">
          <Select
            name="parentId"
            defaultValue={NO_PARENT}
            options={[{ value: NO_PARENT, label: t("newScope") }, ...parents.map((p) => ({ value: p.id, label: p.name[locale] }))]}
          />
        </Field>
      )}
      <NameFields idPrefix={`add-scope-${tradeId}`} />
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("addScope")}
        </Button>
      </div>
      <div className="sm:col-span-2">{alert}</div>
    </form>
  );
}

/**
 * A Trade's Scopes, each followed by its Sub-scopes (`scopes` in tree order,
 * with their level). Every Project Member sees them; a Project Admin changes them.
 */
export function TradeScopes({
  projectId,
  tradeId,
  scopes,
  canEdit,
}: {
  projectId: string;
  tradeId: string;
  scopes: (Scope & { level: number })[];
  canEdit: boolean;
}) {
  const t = useTranslations("scopes");
  return (
    <div className="space-y-3 ps-6">
      <h3 className="text-sm font-semibold text-muted">{t("scopes")}</h3>
      {scopes.length === 0 ? (
        <p className="text-sm text-muted">{t("noScopes")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {scopes.map((s) => (
            <ScopeItem key={s.id} scope={s} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit && (
        <AddScopeForm projectId={projectId} tradeId={tradeId} parents={scopes.filter((s) => s.parentId === null && s.active)} />
      )}
    </div>
  );
}
