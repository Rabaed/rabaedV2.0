"use client";

import { formatNumber, type Locale } from "@rabaed/domain";
import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { allSubmittalPanelSectionsCollapsed, withAllSubmittalPanelSections, type SubmittalPanelItemsTable } from "./panel-sections-model.ts";

export type SubmittalPanelSectionItem = {
  /** Its key in the kept preferences: a section's fold is remembered across submittals. */
  key: string;
  icon: IconName;
  title: string;
  /** The one line its header shows while it is folded (README §4.8). */
  summary: string;
  children: ReactNode;
  /** Shown below 880px only, where the side rail is hidden (the in-flow "Workflow & approval log", RP-1067). */
  inflowOnly?: boolean;
};

export type SubmittalPanelSectionsLabels = {
  /** "5 sections": how many are shown, formatted (`n`) and as a number for the plural (`count`). */
  count: (n: string, count: number) => string;
  collapseAll: string;
  expandAll: string;
};

export type SubmittalPanelSectionsProps = {
  locale: Locale;
  labels: SubmittalPanelSectionsLabels;
  /** The sections this item has data for, in order (`submittalPanelSectionKeys`). */
  sections: readonly SubmittalPanelSectionItem[];
  /** The folded sections, by key (kept in `panel-preferences`). A section not named is open. */
  collapsed: Readonly<Record<string, boolean>>;
  onCollapsedChange: (collapsed: Record<string, boolean>) => void;
};

/**
 * The Details tab's collapsible sections (RP-1066, README §4.7–4.8): "N sections" with Collapse
 * all / Expand all, then each section, whose whole header is the button that folds it. A folded
 * header shows a one-line summary instead of the body.
 */
export function SubmittalPanelSections({ locale, labels, sections, collapsed, onCollapsedChange }: SubmittalPanelSectionsProps) {
  const id = useId();
  const keys = sections.map((s) => s.key);
  const allFolded = allSubmittalPanelSectionsCollapsed(keys, collapsed);
  // From 880px an in-flow-only section is the rail's, so it isn't counted there.
  const wideCount = sections.filter((s) => !s.inflowOnly).length;
  return (
    <div className="sdp-sections">
      <div className="sdp-section-controls flex items-center gap-1.5 px-5 pt-3 pb-2 text-[12px] text-muted @[880px]/sdp:px-7">
        <span className={cn("me-auto font-semibold", wideCount !== sections.length && "@[880px]/sdp:hidden")}>{labels.count(formatNumber(sections.length, locale), sections.length)}</span>
        {wideCount !== sections.length && <span className="me-auto hidden font-semibold @[880px]/sdp:inline">{labels.count(formatNumber(wideCount, locale), wideCount)}</span>}
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[12.5px]" onClick={() => onCollapsedChange(withAllSubmittalPanelSections(keys, collapsed, !allFolded))}>
          <Icon name={allFolded ? "chevron-down" : "chevron-up"} size={15} />
          {allFolded ? labels.expandAll : labels.collapseAll}
        </Button>
      </div>
      <div className="flex flex-col gap-2 px-5 @[880px]/sdp:px-7">
        {sections.map((section) => {
          const open = collapsed[section.key] !== true;
          const bodyId = `${id}-${section.key}`;
          return (
            <section
              key={section.key}
              data-section={section.key}
              className={cn("sdp-section rounded-[12px] bg-surface shadow-[inset_0_0_0_1px_var(--border-subtle)]", section.inflowOnly && "sdp-inflow")}
            >
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? bodyId : undefined}
                  onClick={() => onCollapsedChange({ ...collapsed, [section.key]: open })}
                  className={cn(
                    "sdp-section-head flex min-h-12 w-full items-center gap-2.5 rounded-[12px] px-3 text-start hover:bg-hover",
                    focusRing,
                    // Inside the section's own outline, where an outside ring would sit on the next section.
                    "focus-visible:-outline-offset-2",
                    open && "rounded-b-none",
                  )}
                >
                  <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-subtle text-text-secondary">
                    <Icon name={section.icon} size={15} />
                  </span>
                  <span className="text-[14px] font-semibold whitespace-nowrap">{section.title}</span>
                  {/* The summary while folded only: open, the body says it. */}
                  <span dir="auto" className={cn("sdp-section-summary min-w-0 flex-1 truncate text-[12.5px] text-muted", open && "invisible")}>
                    {section.summary}
                  </span>
                  <Icon name="chevron-down" size={16} className={cn("ms-auto shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
                </button>
              </h3>
              {open && (
                <div id={bodyId} className="sdp-section-body ps-[50px] pe-4 pt-0.5 pb-4 @max-[479px]/sdp:ps-4">
                  {section.children}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A section's fields: one column, two from 560px, three from 1160px (README §3). */
export function SubmittalPanelFields({ fields }: { fields: readonly { key: string; label: string; value: ReactNode; full?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @[560px]/sdp:grid-cols-2 @[1160px]/sdp:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} data-field={field.key} className={cn("min-w-0", field.full && "col-span-full")}>
          <dt className="mb-1 text-[11.5px] text-muted">{field.label}</dt>
          <dd className="text-[13.5px] leading-normal text-pretty [overflow-wrap:anywhere]">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Rounded tags, e.g. the Scopes within the Trade. */
export function SubmittalPanelTags({ tags }: { tags: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag} className="inline-flex h-[26px] items-center rounded-full bg-surface-subtle px-2.5 text-[12.5px] font-semibold shadow-[inset_0_0_0_1px_var(--border-subtle)]">
          {tag}
        </li>
      ))}
    </ul>
  );
}

/** The Location, top level first, as chips in the reading direction. */
export function SubmittalPanelPath({ locale, label, levels }: { locale: Locale; label: string; levels: readonly string[] }) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-1">
      {levels.map((level, i) => (
        <li key={i} className="flex items-center gap-1">
          {i > 0 && <Icon name={locale === "ar" ? "chevron-left" : "chevron-right"} size={14} className="text-faint" />}
          <span className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-surface-subtle px-2.5 text-[13px] font-semibold shadow-[inset_0_0_0_1px_var(--border-subtle)]">
            {i === 0 && <Icon name="map-pin" size={14} className="text-muted" />}
            {level}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** An items table, as the Form's table field holds it (`submittalPanelSupplier`), in the kit's Table: a named region that scrolls, by keyboard too. */
export function SubmittalPanelItems({ table, none }: { table: SubmittalPanelItemsTable; none: string }) {
  return (
    <Table label={table.label} containerClassName="rounded-[10px] border-border-subtle" className="text-[13px]">
      <TableHeader>
        <TableRow>
          {table.columns.map((c) => (
            <TableHead key={c.key} align={c.numeric ? "end" : "start"} className="h-9 text-[11.5px]">
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={table.columns.length} className="h-9 text-muted">
              {none}
            </TableCell>
          </TableRow>
        ) : (
          table.rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, c) => (
                <TableCell key={table.columns[c]!.key} align={table.columns[c]!.numeric ? "end" : "start"} dir={table.columns[c]!.numeric ? undefined : "auto"} className="h-9">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export type SubmittalPanelLinkItem = {
  /** The Link's own id. */
  id: string;
  documentNumber: string;
  subject: string;
  /**
   * Where it opens: the linked item when the viewer sees it, else the Link's own page, by the
   * Link's id, which says only that they may not see its details (Links row, RP-521). The hidden
   * item's id never reaches the browser.
   */
  href: string;
};

/**
 * The Links section (decision C2: Links only): each linked item's Document Number, left to right
 * in Arabic too, and its Subject. A linked item the viewer can't see shows the same two only, as
 * the Links read gives it.
 */
export function SubmittalPanelLinks({ links, none, linkAs: Anchor = "a" }: { links: readonly SubmittalPanelLinkItem[]; none: string; linkAs?: ElementType }) {
  if (links.length === 0) return <p className="text-[13px] text-muted">{none}</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {links.map((link) => (
        <li key={link.id}>
          {/* 28px high, a comfortable target beside the next Link. */}
          <Anchor href={link.href} data-link={link.id} className={cn("flex min-h-7 min-w-0 items-center gap-2 rounded-xs text-[13px] hover:underline", focusRing)}>
            <Icon name="link" size={15} className="shrink-0 text-muted" />
            <DocNo value={link.documentNumber} className="font-bold" />
            <span dir="auto" className="min-w-0 truncate text-muted">
              {link.subject}
            </span>
          </Anchor>
        </li>
      ))}
    </ul>
  );
}
