"use client";

import { formFields, formatNumber, levelSeparator, listSeparator, type Locale, type WorkItemDetail } from "@rabaed/domain";
import {
  DocNo,
  SubmittalPanelFields,
  SubmittalPanelLinks,
  SubmittalPanelPath,
  SubmittalPanelTabs,
  SubmittalPanelTags,
  TradeChip,
  readSubmittalPanelPreferences,
  submittalPanelSectionKeys,
  submittalPanelStorage,
  submittalPanelTab,
  writeSubmittalPanelPreferences,
  type SubmittalPanelPreferences,
  type SubmittalPanelSectionItem,
  type SubmittalPanelTabItem,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { ReplyChecklists } from "@/components/reply-checklists";
import { useSubmittalPanelAttachments } from "@/components/submittal-panel-attachments";
import { useSubmittalPanelChatTab } from "@/components/submittal-panel-chat";
import { questionLabelsOf, type SubmittalPanelReads } from "@/components/submittal-panel-form";
import { useSubmittalPanelItemFacts } from "@/components/submittal-panel-item-facts";
import type { SubmittalPanelLog } from "@/components/submittal-panel-log";
import { WorkItemAnswers, useWorkItemForm } from "@/components/work-item-form";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemLinkedFrom } from "@/components/work-item-linked-from";
import { WorkItemLinks } from "@/components/work-item-links";
import { Link } from "@/i18n/navigation";
import { submittalPanelLinks } from "@/lib/submittal-panel-links";

/** The Built-in Fields the Scope and Location sections show: the Form leaves them out while it is read (RP-1237 row 12). */
const builtInsShownBySections = ["trade", "scopes", "location"] as const;

/**
 * The Submittal Panel's tabs and Details sections (RP-1066; RP-1237 rows 11–14): Subject, Scope and
 * Location (the System and Built-in Fields), then each of the Form's own sections in the same folding
 * card, so every Form answer shows, then Attachments and Links. While its holder edits (row 28) the Form
 * holds its Built-in Fields itself, and the Scope and Location sections step aside. Everything comes from
 * the reads the item page used (`useSubmittalPanelReads`), so it shows exactly what the viewer may see.
 * Chat is always offered (RP-1069); Internal Communication only to a Member of a Participant with internal
 * history on the item (V5). The open tab and the folded sections are kept in this browser.
 */
export function SubmittalPanelDetails({
  item,
  locale,
  place,
  refreshKey,
  log,
  reads,
  failed,
  onEdit,
}: {
  item: WorkItemDetail;
  locale: Locale;
  /** The Location, top level first; empty when it has none. */
  place: string[];
  /** Changes when the item is read again: its details are read again too. */
  refreshKey: unknown;
  /** The in-flow "Workflow & approval log" section and the Internal Communication tab (RP-1067). */
  log: Pick<SubmittalPanelLog, "section" | "internal">;
  /** The Form, Documents and Links reads (`useSubmittalPanelReads`); null while they are read. */
  reads: SubmittalPanelReads | null;
  /** They couldn't be read. */
  failed: boolean;
  /** Turns on Edit (the holder's, row 28). */
  onEdit: () => void;
}) {
  const t = useTranslations("submittalPanelDetails");
  const chat = useSubmittalPanelChatTab({ item, locale, refreshKey });
  const attachments = useSubmittalPanelAttachments({ item, locale, refreshKey });
  const facts = useSubmittalPanelItemFacts(item, locale);
  const form = useWorkItemForm();
  const [prefs, setPrefs] = useState<Pick<SubmittalPanelPreferences, "collapsed" | "tab">>(() => readSubmittalPanelPreferences(submittalPanelStorage()));
  /** Shows the viewer's choice and keeps it in this browser. */
  const remember = (change: Partial<Pick<SubmittalPanelPreferences, "collapsed" | "tab">>) => {
    setPrefs((now) => ({ ...now, ...change }));
    writeSubmittalPanelPreferences(submittalPanelStorage(), change);
  };

  const ready = reads?.id === item.id ? reads : null;
  const editing = form?.editable ?? false;
  const latin = (value: number) => formatNumber(value, locale);
  const empty = <span className="text-faint">{t("none")}</span>;

  const lead = (data: SubmittalPanelReads): SubmittalPanelSectionItem[] => {
    const keys = submittalPanelSectionKeys(data.form.schema);
    const scopes = item.scopes.map((s) => s.name[locale]);
    return [
      // The approval log's own section first (README §4.8), shown below 880px only.
      ...(log.section ? [log.section] : []),
      {
        key: "subject",
        icon: "file-text",
        title: t("subject"),
        summary: item.title,
        children: (
          <SubmittalPanelFields
            fields={[
              { key: "subject", label: t("subject"), value: <span dir="auto">{item.title}</span>, full: true },
              { key: "type", label: t("type"), value: item.type.name[locale] },
              ...(item.revisionNo > 0 ? [{ key: "revision", label: t("revision"), value: latin(item.revisionNo) }] : []),
              ...facts,
            ]}
          />
        ),
      },
      ...(!editing && keys.includes("scope")
        ? [
            {
              key: "scope",
              icon: "category" as const,
              title: t("scope"),
              summary: [item.trade.name[locale], scopes.join(listSeparator[locale])].filter(Boolean).join(" · "),
              children: (
                <SubmittalPanelFields
                  fields={[
                    { key: "trade", label: t("trade"), value: <TradeChip code={item.trade.code} name={item.trade.name[locale]} /> },
                    // Its Package only where the viewer sees it: the item read leaves it out otherwise.
                    ...(item.package
                      ? [{ key: "package", label: t("package"), value: <span><DocNo value={item.package.number} /> <span dir="auto">{item.package.name[locale]}</span></span> }]
                      : []),
                    { key: "scopes", label: t("scopes"), value: scopes.length === 0 ? empty : <SubmittalPanelTags tags={scopes} />, full: true },
                  ]}
                />
              ),
            },
          ]
        : []),
      ...(!editing && keys.includes("location")
        ? [
            {
              key: "location",
              icon: "map-pin" as const,
              title: t("location"),
              summary: place.length === 0 ? t("none") : place.join(levelSeparator[locale]),
              children: place.length === 0 ? empty : <SubmittalPanelPath label={t("location")} levels={place} />,
            },
          ]
        : []),
    ];
  };

  // "Linked from" inside Links (RP-1301; dropped by RP-1237 row 40, back on the owner's word of 2026-11-13): the
  // Submitted items the viewer sees linking here, each opening that item in the panel (its own link lands on its
  // List with the panel open). Shown only when there is one: a linking item the viewer can't see is never in the read.
  const linkedFrom = (data: SubmittalPanelReads): ReactNode =>
    data.linkedFrom && data.linkedFrom.length > 0 ? <WorkItemLinkedFrom items={data.linkedFrom} look="rows" /> : null;

  const tail = (data: SubmittalPanelReads): SubmittalPanelSectionItem[] => [
    // Where the viewer may add files, the item page's own control; otherwise the panel's cards (row 14).
    data.documents.canChange
      ? { ...attachments, children: <WorkItemAttachments workItemId={item.id} list={data.documents} locale={locale} titleHidden /> }
      : attachments,
    {
      key: "links",
      icon: "link",
      title: t("links"),
      summary: t("linkCount", { count: data.links.links.length, n: latin(data.links.links.length) }),
      children: data.links.canChange ? (
        <WorkItemLinks workItemId={item.id} projectId={item.projectId} list={data.links} locale={locale} questionLabels={questionLabelsOf(data, locale)} titleHidden look="rows">
          {linkedFrom(data)}
        </WorkItemLinks>
      ) : (
        <div className="flex flex-col gap-4">
          <SubmittalPanelLinks links={submittalPanelLinks(item.id, data.links.links)} none={t("noLinks")} linkAs={Link} />
          {linkedFrom(data)}
        </div>
      ),
    },
  ];

  // The fields to fix, while its holder edits: the banner lists them; each section holding one stays open.
  // A refused Send names the fields to fix (the Action Form's 'form_incomplete'): their labels, in Form order.
  const marked = new Set(form?.errors.map((e) => e.key) ?? []);
  const toFix = form ? formFields(form.schema).flatMap((f) => (marked.has(f.key) && "label" in f ? [f.label[locale]] : [])) : [];
  // The holder then edits at once, so each field to fix is marked where it is (row 28).
  const mayEdit = item.actions.saveAnswers;
  useEffect(() => {
    if (marked.size > 0 && !editing && mayEdit) onEdit();
  }, [marked.size, editing, mayEdit, onEdit]);
  const details: ReactNode = failed ? (
    <p role="alert" className="px-5 py-6 text-sm text-muted">
      {t("unavailable")}
    </p>
  ) : !ready || !form ? (
    <p role="status" className="px-5 py-6 text-sm text-muted">
      {t("loading")}
    </p>
  ) : (
    <div className="flex flex-col gap-3">
      {toFix.length > 0 && (
        <p role="alert" className="mx-5 mt-3 rounded-[10px] bg-danger-tint px-3 py-2 text-sm font-semibold text-danger-fg">
          {t("toFix", { count: toFix.length, n: latin(toFix.length), fields: toFix.join(listSeparator[locale]) })}
        </p>
      )}
      {/* The checklists its holder answers for the Transition that takes them (RP-86): theirs alone until then (V19). */}
      {item.replyChecklists.length > 0 && (
        <div className="px-5 pt-3">
          <ReplyChecklists workItemId={item.id} checklists={item.replyChecklists} documents={ready.documents} locale={locale} />
        </div>
      )}
      <WorkItemAnswers
        locale={locale}
        workItemId={item.id}
        documents={ready.documents}
        replyChecklists={item.replyChecklists}
        hiddenFieldTypes={builtInsShownBySections}
        look={{ answers: "page" }}
        folding={{
          lead: lead(ready),
          tail: tail(ready),
          labels: { count: (n, count) => t("sectionCount", { count, n }), collapseAll: t("collapseAll"), expandAll: t("expandAll") },
          nothing: t("nothingAnswered"),
          collapsed: prefs.collapsed,
          onCollapsedChange: (collapsed) => remember({ collapsed }),
        }}
      />
    </div>
  );

  const tabs: SubmittalPanelTabItem[] = [
    { key: "details", label: t("details"), content: details },
    chat,
    ...(log.internal ? [{ key: "internal", label: t("internal"), icon: "lock" as const, count: log.internal.count, content: log.internal.content }] : []),
  ];

  return <SubmittalPanelTabs locale={locale} label={t("tabs")} tabs={tabs} value={submittalPanelTab(prefs.tab, tabs.map((tab) => tab.key))} onValueChange={(tab) => remember({ tab })} />;
}
