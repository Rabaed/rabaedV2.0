"use client";

import { formatNumber, type Locale, type RegisterImport } from "@rabaed/domain";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Icon } from "../icon/icon.tsx";
import type { Translate } from "../workflow/workflow-builder-labels-from.ts";
import { PackageCell } from "./register-import-rows.tsx";
import { importLog, importSummary, labelOf, type CountLine } from "./register-import-summary.ts";

// The Validate step's Log tab and the summary above "What will be imported" (RP-1144; the kit's
// import-register.html, imp/wizard.js › sValidate and sConfirm). `t` is the `registerImport` messages.

type LogShown = "all" | "error" | "info";

/** The validation log in the page: every line, or the errors or the information only, and its download. No time. */
export function ImportLog({ imported, t, locale, onDownload }: { imported: RegisterImport; t: Translate; locale: Locale; onDownload: () => void }) {
  const [shown, setShown] = useState<LogShown>("all");
  const lines = importLog(imported, t, locale).filter((l) => shown === "all" || l.level === shown);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={t("log.levels")}
          value={shown}
          onValueChange={(value) => setShown(value === "error" || value === "info" ? value : "all")}
          options={(["all", "error", "info"] as const).map((level) => ({ value: level, label: t(`log.${level}`) }))}
        />
        <Button variant="secondary" size="sm" className="ms-auto" onClick={onDownload}>
          <Icon name="download" />
          {t("validate.downloadLog")}
        </Button>
      </div>
      <ol aria-label={t("log.tab")} className="flex max-h-[480px] flex-col overflow-auto rounded-md border border-border bg-surface-subtle p-3 text-[13px] leading-relaxed">
        {lines.map((line, index) => (
          <li key={index} className={cn("flex gap-2", line.level === "error" && "text-danger-fg")}>
            <span className="w-14 shrink-0 font-bold">{line.level === "error" ? t("log.errorLabel") : t("log.infoLabel")}</span>
            <bdi className="min-w-0 break-words">{line.text}</bdi>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Counts({ title, lines, locale, n, children }: { title: string; lines: CountLine[]; locale: Locale; n: (v: number) => string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3">
      <h3 className="text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase">{title}</h3>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.key} className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-2.5 py-1.5 text-[13.5px]">
            <bdi className="min-w-0 truncate">{labelOf(line, locale)}</bdi>
            <span className="font-bold tabular-nums">{n(line.rows)}</span>
          </li>
        ))}
        {children}
      </ul>
    </section>
  );
}

/** What will be imported: how many Drafts, made together or not at all, by Type, Trade, Package and who raises them. */
export function ImportSummary({ imported, t, locale }: { imported: RegisterImport; t: Translate; locale: Locale }) {
  const n = (value: number) => formatNumber(value, locale);
  const summary = importSummary(imported);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[16px] font-bold">{t("summary.title", { count: summary.drafts, n: n(summary.drafts) })}</h3>
        <p className="text-[13px] text-muted">
          {t("summary.from", { file: imported.fileName, sheet: imported.sheet })}
        </p>
        <p className="mt-1 flex items-start gap-2 rounded-sm bg-surface-subtle px-3 py-2 text-[13px] text-text-secondary">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
          {t("summary.allOrNone", { count: summary.drafts, n: n(summary.drafts) })}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Counts title={t("summary.byType")} lines={summary.byType} locale={locale} n={n} />
        <Counts title={t("summary.byTrade")} lines={summary.byTrade} locale={locale} n={n} />
        <Counts title={t("validate.packages")} lines={[]} locale={locale} n={n}>
          {summary.packages.map((p) => (
            <li key={p.package?.id ?? `new:${p.newName}`} className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-2.5 py-1.5 text-[13.5px]">
              <PackageCell value={{ text: "", match: p.package, new: p.package ? null : p.newName }} locale={locale} newLabel={t("validate.newPackage")} marked={false} />
              <span className="font-bold tabular-nums">{n(p.rows)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13.5px] text-muted">
            <span>{t("summary.noPackage")}</span>
            <span className="font-bold tabular-nums">{n(summary.noPackage)}</span>
          </li>
        </Counts>
        <Counts title={t("summary.raisedBy")} lines={summary.byRaiser} locale={locale} n={n} />
      </div>
    </div>
  );
}
