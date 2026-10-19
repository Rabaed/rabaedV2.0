"use client";

import type { Locale, PackageStatus, RegisterImportPackage, RegisterValues } from "@rabaed/domain";
import { Badge } from "../data/badge.tsx";
import { Input } from "../form/input.tsx";
import { RadioGroup } from "../form/radio-group.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Select } from "../form/select.tsx";
import { Icon } from "../icon/icon.tsx";
import type { Translate } from "../workflow/workflow-builder-labels-from.ts";
import { within } from "./register-import-rows.tsx";

// The Packages card of the wizard's Assign & packages step (RP-644, spec RP-631 stories 28–31;
// the owner's design RP-634 › Assign & packages › Packages): no Package, one Package for the
// whole register (new, or an Open Package of the importer's own Company), or one per value of
// the Package column, each name an Open Package it matches, a new one, or one chosen by hand.
// Only Open Packages are offered: a name matching one In Progress or Done shows its status, and
// Validate refuses its rows.

/** Where the Drafts go: the wizard's choice, made into the mapping's `packages` or `package` and `values.package`. */
export type PackagesChoice = { mode: "none" } | { mode: "file"; how: "new" | "existing"; name: string; existing: string | null } | { mode: "column" };

/** A Package status's tone, as the design draws it. */
const statusTone: Record<PackageStatus, "info" | "warning" | "success"> = { open: "info", in_progress: "warning", done: "success" };

export function PackagesCard({
  t: messages,
  locale,
  n,
  packages,
  choice,
  onChoice,
  column,
  values,
  picks,
  onPick,
  dataRows,
}: {
  /** The `registerImport` messages. */
  t: Translate;
  locale: Locale;
  n: (value: number) => string;
  /** The importer's own Company's Packages on the Project (registerImportFields.packages). */
  packages: RegisterImportPackage[];
  choice: PackagesChoice;
  onChoice: (choice: PackagesChoice) => void;
  /** The column mapped to Package, by its heading and its letter; null when none is. */
  column: { name: string; letter: string } | null;
  /** The Package column's names, as the api matched them. */
  values: RegisterValues["fields"][number] | undefined;
  /** The choices made by hand, by name's key: an existing Package's id, or `new`. */
  picks: Record<string, string>;
  onPick: (key: string, pick: string | undefined) => void;
  dataRows: number;
}) {
  const t = within(messages, "packages");
  const open = packages.filter((k) => k.status === "open");
  const byId = new Map(packages.map((k) => [k.id, k]));
  const label = (k: RegisterImportPackage) => `${k.number} · ${k.name[locale]}`;
  /** The Open Packages to choose from, and the chosen one when it no longer is Open (to show it). */
  const optionsWith = (chosen: string | null) => {
    const shown = chosen && !open.some((k) => k.id === chosen) && byId.has(chosen) ? [byId.get(chosen)!, ...open] : open;
    return shown.map((k) => ({ value: k.id, label: label(k) }));
  };
  const statusBadge = (id: string | null) => {
    const pkg = id ? byId.get(id) : undefined;
    return pkg ? (
      <Badge tone={statusTone[pkg.status]} dot data-package-status={pkg.status}>
        {t(`status.${pkg.status}`)}
      </Badge>
    ) : null;
  };
  const named = values?.values.reduce((sum, v) => sum + v.rows, 0) ?? 0;

  return (
    <section aria-labelledby="packages-heading" className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <h2 id="packages-heading" className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase">
        <Icon name="packages" size={14} />
        {t("title")}
      </h2>
      <RadioGroup
        aria-label={t("choice")}
        className="flex-row flex-wrap gap-x-5 gap-y-2"
        value={choice.mode}
        onValueChange={(mode) =>
          onChoice(mode === "file" ? { mode: "file", how: "new", name: "", existing: null } : mode === "column" ? { mode: "column" } : { mode: "none" })
        }
        options={[
          { value: "none", label: t("none") },
          { value: "file", label: t("file") },
          { value: "column", label: t("column"), disabled: column === null },
        ]}
      />

      {choice.mode === "file" && (
        <div className="flex flex-col gap-2 rounded-sm bg-surface-subtle p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              aria-label={t("newOrExisting", { value: t("file") })}
              value={choice.how}
              onValueChange={(how) => onChoice({ ...choice, how: how === "existing" ? "existing" : "new" })}
              options={[
                { value: "new", label: t("new") },
                { value: "existing", label: t("existing"), disabled: open.length === 0 },
              ]}
            />
            {choice.how === "new" ? (
              <Input
                className="min-w-48 flex-1"
                aria-label={t("newFile")}
                maxLength={200}
                value={choice.name}
                onChange={(e) => onChoice({ ...choice, name: e.target.value })}
              />
            ) : (
              <Select
                className="min-w-48 flex-1"
                aria-label={t("existingFile")}
                placeholder={t("chooseOpen")}
                value={choice.existing ?? ""}
                onValueChange={(existing) => onChoice({ ...choice, existing })}
                options={optionsWith(choice.existing)}
              />
            )}
          </div>
          {choice.how === "existing" && statusBadge(choice.existing)}
        </div>
      )}

      {choice.mode === "column" && column && (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-text-secondary">
            <Icon name="table" size={16} />
            <span>{t("columnLabel")}</span>
            <span className="inline-flex size-5 items-center justify-center rounded-xs border border-border text-[11px] font-bold">{column.letter}</span>
            <bdi className="font-semibold text-text">{column.name}</bdi>
          </p>
          <ul aria-label={t("column")} className="flex flex-col gap-2">
            {(values?.values ?? []).map((v) => {
              const pick = picks[v.key];
              const chosen = pick === "new" ? null : (pick ?? (v.how === "exact" ? v.match : null));
              const how = chosen ? "existing" : "new";
              return (
                <li key={v.key} className="grid gap-2 rounded-sm bg-surface-subtle px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] sm:items-center">
                  <span className="flex min-w-0 flex-col">
                    <bdi className="truncate font-semibold">{v.text}</bdi>
                    <span className="text-[12.5px] text-muted">{t("rows", { count: v.rows, n: n(v.rows) })}</span>
                  </span>
                  <SegmentedControl
                    aria-label={t("newOrExisting", { value: v.text })}
                    value={how}
                    onValueChange={(next) => {
                      if (next === "new") onPick(v.key, v.how === "exact" && v.match ? "new" : undefined);
                      else onPick(v.key, (v.how === "exact" && v.match && open.some((k) => k.id === v.match) ? v.match : open[0]?.id) ?? undefined);
                    }}
                    options={[
                      { value: "new", label: t("new") },
                      { value: "existing", label: t("existing"), disabled: open.length === 0 && !chosen },
                    ]}
                  />
                  <span className="flex min-w-0 flex-col gap-1.5">
                    {how === "new" ? (
                      <span className="flex h-9 items-center rounded-sm border border-border bg-surface px-3 text-[14px]">
                        <span className="sr-only">{t("newFile")}</span>
                        <bdi className="truncate">{v.text}</bdi>
                      </span>
                    ) : (
                      <Select
                        aria-label={t("existingFor", { value: v.text })}
                        aria-invalid={chosen !== null && byId.get(chosen)?.status !== "open"}
                        value={chosen ?? ""}
                        onValueChange={(id) => onPick(v.key, id)}
                        options={optionsWith(chosen)}
                      />
                    )}
                    {how === "existing" && <span>{statusBadge(chosen)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {dataRows - named > 0 && <p className="text-[13px] text-muted">{t("noValue", { count: dataRows - named, n: n(dataRows - named) })}</p>}
        </>
      )}
      {choice.mode === "column" && !column && <p className="text-[13px] text-muted">{t("noColumn")}</p>}
      {open.length === 0 && choice.mode !== "none" && <p className="text-[13px] text-muted">{t("noneOpen")}</p>}
      <p className="text-[13px] text-muted">{t("help")}</p>
    </section>
  );
}
