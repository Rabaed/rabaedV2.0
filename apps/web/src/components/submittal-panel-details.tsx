"use client";

import {
  formatNumber,
  formFields,
  levelSeparator,
  listSeparator,
  type ApprovedSuppliers,
  type FormToFill,
  type Locale,
  type OptionList,
  type SupplierChoice,
  type WorkItemDetail,
  type WorkItemHistory,
  type WorkItemLinks,
} from "@rabaed/domain";
import {
  DocNo,
  SubmittalPanelFields,
  SubmittalPanelItems,
  SubmittalPanelLinks,
  SubmittalPanelPath,
  SubmittalPanelSections,
  SubmittalPanelTabs,
  SubmittalPanelTags,
  TradeChip,
  readSubmittalPanelPreferences,
  submittalPanelInternalCount,
  submittalPanelSectionKeys,
  submittalPanelStorage,
  submittalPanelSupplier,
  submittalPanelTab,
  writeSubmittalPanelPreferences,
  type SubmittalPanelPreferences,
  type SubmittalPanelSectionItem,
  type SubmittalPanelSectionKey,
  type SubmittalPanelTabItem,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { submittalPanelLinks } from "@/lib/submittal-panel-links";

/** What the Details tab reads for one item, beside the item read: its Form, Links and history, and the names its answers need. */
type DetailsRead =
  | { id: string; ok: true; form: FormToFill; links: WorkItemLinks; history: WorkItemHistory; suppliers: SupplierChoice[]; optionLists: OptionList[] }
  | { id: string; ok: false };

async function readJson<T>(path: string, signal: AbortSignal): Promise<T | null> {
  const res = await fetch(`/api/v1${path}`, { signal });
  return res.ok ? ((await res.json()) as T) : null;
}

/** The Form's text answer by key, when it asks one: the Description, the Specification section. */
function textAnswer(form: FormToFill, answers: WorkItemDetail["answers"], key: string): string | null {
  const field = formFields(form.schema).find((f) => f.key === key);
  const value = answers[key];
  return field && (field.type === "text" || field.type === "textarea") && typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * The Submittal Panel's tabs and Details sections (RP-1066, spec RP-1054): read from the reads the
 * item page uses, so it shows exactly what the viewer may see. Internal Communication is offered
 * only to a Member of a Participant with internal history on the item: the history read gives
 * internal events only within the viewer's own Participant (V5). The open tab and the folded
 * sections are kept in this browser, across submittals.
 */
export function SubmittalPanelDetails({
  item,
  locale,
  place,
  refreshKey,
}: {
  item: WorkItemDetail;
  locale: Locale;
  /** The Location, top level first; empty when it has none. */
  place: string[];
  /** Changes when the item is read again: its details are read again too. */
  refreshKey: unknown;
}) {
  const t = useTranslations("submittalPanelDetails");
  const [read, setRead] = useState<DetailsRead | null>(null);
  const [prefs, setPrefs] = useState<Pick<SubmittalPanelPreferences, "collapsed" | "tab">>(() => readSubmittalPanelPreferences(submittalPanelStorage()));
  const keep = (change: Partial<Pick<SubmittalPanelPreferences, "collapsed" | "tab">>) => {
    setPrefs((now) => ({ ...now, ...change }));
    writeSubmittalPanelPreferences(submittalPanelStorage(), change);
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const id = item.id;
    void (async () => {
      const [form, links, history] = await Promise.all([
        readJson<FormToFill>(`/work-items/${id}/form`, signal),
        readJson<WorkItemLinks>(`/work-items/${id}/links`, signal),
        readJson<WorkItemHistory>(`/work-items/${id}/history`, signal),
      ]);
      if (!form || !links || !history) return setRead({ id, ok: false });
      // The names its answers need, only when its Form asks them.
      const fields = formFields(form.schema);
      const [suppliers, lists] = await Promise.all([
        fields.some((f) => f.type === "approved_supplier") ? readJson<ApprovedSuppliers>(`/projects/${item.projectId}/approved-suppliers`, signal) : null,
        fields.some((f) => f.type === "table" && f.columns.some((c) => c.type === "option_list")) ? readJson<{ optionLists: OptionList[] }>("/option-lists", signal) : null,
      ]);
      setRead({
        id,
        ok: true,
        form,
        links,
        history,
        suppliers: (suppliers?.suppliers ?? []).map((s) => ({ id: s.id, tradeId: s.tradeId, status: s.status, name: s.name })),
        optionLists: lists?.optionLists ?? [],
      });
    })().catch(() => {
      if (!signal.aborted) setRead({ id, ok: false });
    });
    return () => controller.abort();
  }, [item.id, item.projectId, refreshKey]);

  const ready = read?.id === item.id ? read : null;
  const internal = ready?.ok ? submittalPanelInternalCount(ready.history.events) : 0;
  const offered = internal > 0 ? ["details", "internal"] : ["details"];
  const shown = ready?.ok ? submittalPanelSectionKeys(ready.form.schema) : [];

  const details: ReactNode = !ready ? (
    <p role="status" className="px-5 py-6 text-sm text-muted">
      {t("loading")}
    </p>
  ) : !ready.ok ? (
    <p role="alert" className="px-5 py-6 text-sm text-muted">
      {t("unavailable")}
    </p>
  ) : (
    <SubmittalPanelSections
      locale={locale}
      labels={{
        count: (n) => t("sectionCount", { count: shown.length, n }),
        collapseAll: t("collapseAll"),
        expandAll: t("expandAll"),
      }}
      sections={shown.map((key) => section(key, ready))}
      collapsed={prefs.collapsed}
      onCollapsedChange={(collapsed) => keep({ collapsed })}
    />
  );

  function section(key: SubmittalPanelSectionKey, data: Extract<DetailsRead, { ok: true }>): SubmittalPanelSectionItem {
    const n = (value: number) => formatNumber(value, locale);
    const none = <span className="text-faint">{t("none")}</span>;
    switch (key) {
      case "subject": {
        const description = textAnswer(data.form, item.answers, "description");
        const specification = textAnswer(data.form, item.answers, "specification_section");
        return {
          key,
          icon: "file-text",
          title: t("subject"),
          summary: item.title,
          children: (
            <SubmittalPanelFields
              fields={[
                { key: "subject", label: t("subject"), value: <span dir="auto">{item.title}</span>, full: true },
                ...(description ? [{ key: "description", label: t("description"), value: <span dir="auto" className="whitespace-pre-line">{description}</span>, full: true }] : []),
                { key: "type", label: t("type"), value: item.type.name[locale] },
                ...(item.revisionNo > 0 ? [{ key: "revision", label: t("revision"), value: n(item.revisionNo) }] : []),
                ...(specification ? [{ key: "specification", label: t("specification"), value: <span dir="auto">{specification}</span> }] : []),
                ...(item.paperRef ? [{ key: "paperRef", label: t("paperRef"), value: <bdi dir="ltr">{item.paperRef}</bdi> }] : []),
              ]}
            />
          ),
        };
      }
      case "scope": {
        const scopes = item.scopes.map((s) => s.name[locale]);
        return {
          key,
          icon: "category",
          title: t("scope"),
          summary: [item.trade.name[locale], scopes.join(listSeparator[locale])].filter(Boolean).join(" · "),
          children: (
            <SubmittalPanelFields
              fields={[
                { key: "trade", label: t("trade"), value: <TradeChip code={item.trade.code} name={item.trade.name[locale]} /> },
                // Its Package only where the viewer sees it: the item read leaves it out otherwise.
                ...(item.package
                  ? [{ key: "package", label: t("package"), value: <span><DocNo value={item.package.number} /> {item.package.name[locale]}</span> }]
                  : []),
                { key: "scopes", label: t("scopes"), value: scopes.length === 0 ? none : <SubmittalPanelTags tags={scopes} />, full: true },
              ]}
            />
          ),
        };
      }
      case "location":
        return {
          key,
          icon: "map-pin",
          title: t("location"),
          summary: place.length === 0 ? t("none") : place.join(levelSeparator[locale]),
          children: place.length === 0 ? none : <SubmittalPanelPath locale={locale} label={t("location")} levels={place} />,
        };
      case "supplier": {
        const supplier = submittalPanelSupplier(data.form.schema, item.answers, data.suppliers, locale, data.optionLists);
        const named = supplier.suppliers.join(listSeparator[locale]);
        return {
          key,
          icon: "buildings",
          title: t("supplier"),
          summary: [named, t("itemCount", { count: supplier.itemCount, n: n(supplier.itemCount) })].filter(Boolean).join(" · "),
          children: (
            <div className="flex flex-col gap-3">
              <SubmittalPanelFields fields={[{ key: "supplier", label: t("approvedSupplier"), value: named || none }]} />
              {supplier.tables.map((table) => (
                <SubmittalPanelItems key={table.key} table={table} none={t("noRows")} />
              ))}
            </div>
          ),
        };
      }
      case "links":
        return {
          key,
          icon: "link",
          title: t("links"),
          summary: t("linkCount", { count: data.links.links.length, n: n(data.links.links.length) }),
          children: <SubmittalPanelLinks links={submittalPanelLinks(item.id, data.links.links)} none={t("noLinks")} linkAs={Link} />,
        };
    }
  }

  const tabs: SubmittalPanelTabItem[] = [
    { key: "details", label: t("details"), content: details },
    // Its timeline comes with the approval log (RP-1067).
    ...(internal > 0
      ? [{ key: "internal", label: t("internal"), icon: "lock" as const, count: internal, content: <p className="px-5 py-4 text-sm text-muted">{t("internalOnly")}</p> }]
      : []),
  ];

  return <SubmittalPanelTabs locale={locale} label={t("tabs")} tabs={tabs} value={submittalPanelTab(prefs.tab, offered)} onValueChange={(tab) => keep({ tab })} />;
}
