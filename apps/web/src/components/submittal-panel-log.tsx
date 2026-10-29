"use client";

import { formatNumber, workItemListHref, type Locale, type Outcome, type ProjectSummary, type SignedInMember, type WorkItemDetail, type WorkItemHistory } from "@rabaed/domain";
import {
  SubmittalApprovalLog,
  SubmittalInternalCommunication,
  SubmittalPanelRail,
  SubmittalPanelWorkflowAndLog,
  submittalApprovalLog,
  submittalInternalLog,
  type SubmittalPanelRailLabels,
  type SubmittalPanelSectionItem,
  type SubmittalTimelineEvent,
  type SubmittalTimelineLabels,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/** One read for one url: what came back, or null when it couldn't be read. */
type Read<T> = { url: string; value: T | null };

/** Reads `url` again whenever `refreshKey` changes, keeping the last answer for the same url meanwhile. */
function useRead<T>(url: string | null, refreshKey?: unknown): Read<T> | null {
  const [read, setRead] = useState<Read<T> | null>(null);
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (res) => setRead({ url, value: res.ok ? ((await res.json()) as T) : null }))
      .catch(() => {
        if (!controller.signal.aborted) setRead({ url, value: null });
      });
    return () => controller.abort();
  }, [url, refreshKey]);
  return read?.url === url ? read : null;
}

export type SubmittalPanelLog = {
  /** The side rail of the Wide and Full bands: Workflow, then the approval log. */
  rail: ReactNode;
  /** The in-flow "Workflow & approval log" section below 880px; null until the history is read. */
  section: SubmittalPanelSectionItem | null;
  /** The Internal Communication tab: only for a Member of a Participant with internal history on the item (V5). */
  internal: { count: number; content: ReactNode } | null;
};

/**
 * The Submittal Panel's approval log and Internal Communication (RP-1067, spec RP-1054 gaps A6–A9):
 * from the item's history read (`GET /v1/work-items/:id/history`, the item page's), split by its
 * audience, so it shows exactly what the viewer may see. No new API. Beside it, the viewer's own
 * Company (`GET /v1/me`), which tells its turns from another Company's, and the Project read, for
 * the viewer's role in the Internal banner. Nothing the read hides is worked out again here.
 *
 * `workflow` and `openMap` are the route strip's (RP-1064): the rail and the section show them above
 * the log.
 */
export function useSubmittalPanelLog({
  item,
  locale,
  refreshKey,
  outcomes,
  workflow,
  openMap,
}: {
  item: WorkItemDetail | null;
  locale: Locale;
  refreshKey?: unknown;
  /** The Project's outcomes per Type (the List's `filters.outcomes`): a Code's dot by its place in its set. */
  outcomes: readonly (Outcome & { type: string })[];
  workflow?: ReactNode;
  openMap?: () => void;
}): SubmittalPanelLog {
  const t = useTranslations("submittalPanelLog");
  const tHistory = useTranslations("workItems.history");
  const history = useRead<WorkItemHistory>(item ? `/api/v1/work-items/${item.id}/history` : null, refreshKey);
  const me = useRead<SignedInMember>(item ? "/api/v1/me" : null);
  const project = useRead<ProjectSummary>(item ? `/api/v1/projects/${item.projectId}` : null);

  const railLabels: SubmittalPanelRailLabels = { workflow: t("workflow"), map: t("map"), log: t("log") };
  if (!item || !history) return { rail: <SubmittalPanelRail labels={railLabels} workflow={workflow} onOpenMap={openMap} log={null} />, section: null, internal: null };

  /** A move as the item page's history words it (`work-item-history.tsx`). */
  const move = (e: SubmittalTimelineEvent): string => {
    if ((e.type === "transition" || e.type === "issue_code") && e.transition) return e.transition[locale];
    if (e.type === "internal_note") return e.transition ? tHistory("internalNoteWith", { transition: e.transition[locale] }) : tHistory("internalNote");
    if (e.type === "internal_answers" && e.transition) return tHistory("internalAnswersWith", { transition: e.transition[locale] });
    if (e.type === "recommend_code") return tHistory("recommendedCode");
    if (e.type === "picked_up" || e.type === "claimed") return tHistory("pickedUp");
    if (e.type === "returned_to_pool" || e.type === "released") return tHistory("returnedToPool");
    if (e.type === "assigned" && e.handover?.because === "reassigned") {
      const to = e.handover.to?.[locale] ?? "";
      return e.handover.from ? tHistory("reassigned", { from: e.handover.from[locale], to }) : tHistory("reassignedFromPool", { to });
    }
    if (e.type === "assigned" && e.handover) {
      return tHistory("handedOver", { from: e.handover.from?.[locale] ?? "", to: e.handover.to?.[locale] ?? "", because: e.handover.because });
    }
    if (e.type === "assigned" && e.by.memberName) return tHistory("assignedOnlyMember", { name: e.by.memberName[locale] });
    if (e.type === "answers_changed") return tHistory("answersChanged");
    return tHistory("other");
  };
  const labels: SubmittalTimelineLabels = {
    created: t("created"),
    review: (company) => t("review", { company }),
    move,
    texts: { coverNote: t("coverNote"), remarks: t("remarks"), internalNote: t("internalNote"), reason: t("reason") },
    comments: (n, count) => t("comments", { n, count }),
    recommendedCode: (code) => t("recommendedCode", { code }),
    empty: t("empty"),
  };

  const typeOutcomes = outcomes.filter((o) => o.type === item.type.code);
  const events = history.value?.events ?? [];
  const entries = submittalApprovalLog({
    events,
    viewerCompany: me?.value?.company.legalName ?? null,
    creationDate: item.creationDate,
    outcomes: typeOutcomes,
    raisedItems: item.raisedItems,
  });
  const documentNumber = item.documentNumber;
  const log = !history.value ? (
    <p role="alert" className="text-[12.5px] text-muted">
      {t("unavailable")}
    </p>
  ) : (
    <SubmittalApprovalLog
      locale={locale}
      labels={labels}
      entries={entries}
      // The Snag List filtered to the Comments raised from this item, where the viewer again sees only their own.
      commentsHref={documentNumber ? (typeCode) => workItemListHref(item.projectId, { module: "snag_list", type: [typeCode], raisedFrom: [documentNumber] }) : undefined}
      linkAs={Link}
    />
  );

  const internalEntries = submittalInternalLog(events, typeOutcomes);
  const company = me?.value?.company.legalName[locale];
  const role = project?.value?.projectRole.baseRole;
  const internal =
    internalEntries.length === 0
      ? null
      : {
          count: internalEntries.length,
          content: (
            <SubmittalInternalCommunication
              locale={locale}
              labels={{ ...labels, empty: t("internalEmpty") }}
              // Worded by the viewer's role; the plain wording while either read is missing.
              banner={company && role ? t("banner", { company, role }) : tHistory("internal")}
              entries={internalEntries}
            />
          ),
        };

  const count = entries.length;
  return {
    rail: <SubmittalPanelRail labels={railLabels} workflow={workflow} onOpenMap={openMap} log={log} />,
    section: {
      key: "workflow",
      icon: "route",
      title: t("section"),
      summary: t("summary", { step: item.step.name[locale], count, n: formatNumber(count, locale) }),
      children: <SubmittalPanelWorkflowAndLog labels={railLabels} workflow={workflow} onOpenMap={openMap} log={log} />,
      inflowOnly: true,
    },
    internal,
  };
}
