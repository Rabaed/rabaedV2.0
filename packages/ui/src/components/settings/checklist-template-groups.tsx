"use client";

import { formatNumber, type BilingualText, type ChecklistTemplate, type Locale } from "@rabaed/domain";
import type { ReactNode } from "react";
import { Badge } from "../data/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { Field } from "../form/field.tsx";
import { Select } from "../form/select.tsx";

// Project → Settings → Checklist Templates (RP-1315, ADR 0031): inside one Trade's card, its templates
// grouped "Whole Trade" first, then by Scope, in the Scopes' order, each Sub-scope's under its Scope's;
// and the editor's Scope picker. Presentational: the page passes the Trade's templates and Scopes.

/** A Scope or Sub-scope of the Trade, in tree order (each Scope followed by its Sub-scopes). */
export type ChecklistTemplateScope = { id: string; parentId: string | null; name: BilingualText; active: boolean };

export type ChecklistTemplateGroupsLabels = {
  wholeTrade: string;
  /** A Sub-scope's group names its Scope: "Sub-scope of Concrete". */
  subScopeOf: (scope: string) => string;
  /** The table's name, by its group: "Checklist Templates for Civil, Concrete". */
  tableLabel: (group: string) => string;
  name: string;
  checks: string;
  version: string;
  status: string;
  open: string;
  versionNo: (n: string) => string;
  statuses: Record<ChecklistTemplate["status"], string>;
};

/** One group of the card: the Trade's templates on one Scope (`scope`), or on the whole Trade (null). */
export type ChecklistTemplateGroup = { scope: ChecklistTemplateScope | null; templates: ChecklistTemplate[] };

/**
 * The Trade's templates by Scope: the whole-Trade ones first, then each Scope's and Sub-scope's in `scopes`' order;
 * a group with no template is left out. Inside a group, active ones first, each in the order given.
 */
export function checklistTemplateGroups(templates: readonly ChecklistTemplate[], scopes: readonly ChecklistTemplateScope[]): ChecklistTemplateGroup[] {
  const ordered = (list: ChecklistTemplate[]) => list.toSorted((a, b) => Number(a.status === "retired") - Number(b.status === "retired"));
  const groups: ChecklistTemplateGroup[] = [{ scope: null, templates: ordered(templates.filter((t) => t.scopeId === null)) }];
  for (const scope of scopes) groups.push({ scope, templates: ordered(templates.filter((t) => t.scopeId === scope.id)) });
  return groups.filter((g) => g.templates.length > 0);
}

/** The Trade's templates, a table per group, each headed by its Scope; `open` renders a row's link to its page. */
export function ChecklistTemplateGroups({
  templates,
  scopes,
  locale,
  labels: t,
  open,
}: {
  templates: readonly ChecklistTemplate[];
  scopes: readonly ChecklistTemplateScope[];
  locale: Locale;
  labels: ChecklistTemplateGroupsLabels;
  open: (template: ChecklistTemplate) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {checklistTemplateGroups(templates, scopes).map(({ scope, templates: listed }) => {
        const parent = scope?.parentId ? scopes.find((s) => s.id === scope.parentId) : undefined;
        const title = scope ? scope.name[locale] : t.wholeTrade;
        return (
          <section key={scope?.id ?? "whole"} className={scope?.parentId ? "flex flex-col gap-2 ps-4" : "flex flex-col gap-2"} data-testid="template-group">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-body font-semibold text-text">
              <bdi>{title}</bdi>
              {parent && <span className="text-sm font-normal text-muted">{t.subScopeOf(parent.name[locale])}</span>}
            </h3>
            <Table label={t.tableLabel(title)} className="min-w-[36rem] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.name}</TableHead>
                  <TableHead className="w-[7rem]">{t.checks}</TableHead>
                  <TableHead className="w-[7rem]">{t.version}</TableHead>
                  <TableHead className="w-[8rem]">{t.status}</TableHead>
                  <TableHead align="end" className="w-[7rem]">
                    <span className="sr-only">{t.open}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listed.map((x) => (
                  <TableRow key={x.id} data-testid="template-row">
                    <TableCell className={`truncate ${x.status === "retired" ? "text-muted" : "font-semibold"}`}>{x.name[locale]}</TableCell>
                    <TableCell className="text-text-secondary">{formatNumber(x.items.length, locale)}</TableCell>
                    <TableCell className="text-text-secondary">{t.versionNo(formatNumber(x.versionNo, locale))}</TableCell>
                    <TableCell>
                      <Badge tone={x.status === "active" ? "success" : "neutral"}>{t.statuses[x.status]}</Badge>
                    </TableCell>
                    <TableCell align="end">{open(x)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}

// A choice can't have an empty value, so the whole Trade has its own.
const WHOLE_TRADE = "whole";

export type ChecklistTemplateScopeFieldLabels = { label: string; help: string; wholeTrade: string; archived: string };

/**
 * The editor's Scope picker: the whole Trade, or one of the Trade's active Scopes and Sub-scopes (a Sub-scope
 * indented under its Scope); the template's own, deactivated since, stays offered, marked, so a save keeps it.
 */
export function ChecklistTemplateScopeField({
  value,
  scopes,
  locale,
  labels,
  disabled = false,
  onChange,
}: {
  /** The Scope picked; null for the whole Trade. */
  value: string | null;
  /** The template's Trade's Scopes and Sub-scopes, in tree order. */
  scopes: readonly ChecklistTemplateScope[];
  locale: Locale;
  labels: ChecklistTemplateScopeFieldLabels;
  disabled?: boolean;
  onChange: (scopeId: string | null) => void;
}) {
  const offered = scopes.filter((s) => s.active || s.id === value);
  const label = (s: ChecklistTemplateScope) => `${s.parentId ? "— " : ""}${s.name[locale]}${s.active ? "" : ` (${labels.archived})`}`;
  return (
    <Field label={labels.label} help={labels.help}>
      <Select
        value={value ?? WHOLE_TRADE}
        disabled={disabled}
        onValueChange={(v) => onChange(v === WHOLE_TRADE ? null : v)}
        options={[{ value: WHOLE_TRADE, label: labels.wholeTrade }, ...offered.map((s) => ({ value: s.id, label: label(s) }))]}
      />
    </Field>
  );
}
