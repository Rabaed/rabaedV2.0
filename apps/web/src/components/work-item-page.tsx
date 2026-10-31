"use client";

import {
  answerFields,
  backwardKinds,
  formatDate,
  formatFormValue,
  formatNumber,
  isOpenStageCategory,
  linksChangeField,
  linksChangeValue,
  sortedByName,
  watchOutcomeNames,
  type DocumentList,
  type FormSchema,
  type LinkedFromItem,
  type Locale,
  type OptionList,
  type Outcome as OutcomeRow,
  type RevisionChain,
  type SignedInMember,
  type WorkItemDetail,
  type WorkItemHistory,
  type WorkItemLinks as Links,
  type WorkItemWorkflowMap,
} from "@rabaed/domain";
import {
  Button,
  CodeTile,
  DocNo,
  Outcome,
  RevisionMenu,
  SaveStatus,
  StagePill,
  StepAgePill,
  SubmittalPanelFacts,
  SubmittalPanelIdentity,
  SubmittalPanelRail,
  SubmittalPanelTabs,
  SubmittalPanelWorkflowAndLog,
  TradeChip,
  WatchButton,
  WorkItemActionsCard,
  WorkItemPageFrame,
  WorkItemPageHistory,
  WorkItemResultCard,
  WorkItemTopBarButton,
  outcomesOfType,
  stageColour,
  submittalPanelNumber,
  submittalPanelWith,
  transitionCodes,
  workItemCodeResult,
  workItemHistoryEntries,
  type SubmittalPanelSectionItem,
  type WatchCall,
  type WorkItemHistoryEntry,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { DownloadRecordButton } from "@/components/download-record-button";
import { DownloadWorkingCopyButton } from "@/components/download-working-copy-button";
import { CreateRevisionButton } from "@/components/submittal-panel-host";
import { useSubmittalPanelChatTab } from "@/components/submittal-panel-chat";
import { useSubmittalPanelLog } from "@/components/submittal-panel-log";
import { SubmittalPanelNumber } from "@/components/submittal-panel-number";
import { useSubmittalPanelRoute } from "@/components/submittal-panel-route";
import { OpenerAlert, useTransitionOpener } from "@/components/work-item-actions";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, useWorkItemForm } from "@/components/work-item-form";
import { WorkItemLinkedFrom } from "@/components/work-item-linked-from";
import { WorkItemLinks } from "@/components/work-item-links";
import { WorkItemRevision } from "@/components/work-item-revision";
import { Link, useRouter } from "@/i18n/navigation";
import type { AnsweredChecklists } from "@/lib/checklist-once";
import { historyMoveLabel } from "@/lib/history-move-label";
import { saveButton } from "@/lib/save-button";

type Event = WorkItemHistory["events"][number];

export type WorkItemPageProps = {
  item: WorkItemDetail;
  locale: Locale;
  me: SignedInMember;
  /** Back to its list: where, and the Module's name. */
  list: { href: string; label: string };
  history: WorkItemHistory | null;
  chain: RevisionChain | null;
  watch: { watching: boolean } | null;
  /** The Workflow map read: which Review Code each offered Transition issues. */
  workflowMap: WorkItemWorkflowMap | null;
  /** The item's Type's outcomes on the Project, for the Issued Code's chip and the History's tones. */
  outcomes: readonly OutcomeRow[];
  schema: FormSchema;
  optionLists: readonly OptionList[];
  documents: DocumentList;
  links: Links;
  linkedFrom: readonly LinkedFromItem[];
  questionLabels: Record<string, string>;
  replyChecklists: AnsweredChecklists;
  /** Server-rendered: notices above the tabs (Sent Back, versions changed, reply checklists, replacement). */
  notices: ReactNode;
  /** Server-rendered: the System Fields and facts beyond the design's (gap table row 22), for the Details card. */
  details: ReactNode;
};

/**
 * The Work Item page (RP-1151; the owner's "Rabaed Work Item Page", gap table approved 2026-10-31):
 * the Submittal Panel at page size. It reads only what the page's server reads give the viewer,
 * through the same components the panel and the old page used, so it shows nothing more: another
 * Company by its name only, but the Code's signer (V14); internal moves inside the viewer's own
 * Company (V5); no due date, Step Age in weeks.
 */
export function WorkItemPage(props: WorkItemPageProps) {
  const { item, locale, me, list, history, chain, watch, workflowMap, outcomes, documents, links, linkedFrom, questionLabels, replyChecklists, notices, details } = props;
  const t = useTranslations("workItemPage");
  const tItems = useTranslations("workItems");
  const tHistory = useTranslations("workItems.history");
  const tFacts = useTranslations("submittalPanel");
  const tDetails = useTranslations("submittalPanelDetails");
  const tLog = useTranslations("submittalPanelLog");
  const tWatch = useTranslations("watch");
  const tMap = useTranslations("workflowMap");
  const tViews = useTranslations("workItemViews");
  const tRevision = useTranslations("revision");
  const form = useWorkItemForm();
  const router = useRouter();
  const [tab, setTab] = useState("form");

  const typeOutcomes = outcomesOfType(item.type.code, [...outcomes]);
  const codes = transitionCodes(item.actions.transitions, workflowMap?.definition ?? null);
  const opener = useTransitionOpener(item.id, item.actions, locale, (tr) => ({ code: codes[tr.key] ?? null, documentNumber: item.documentNumber }));
  const { route, workflow, openMap } = useSubmittalPanelRoute(item, locale);
  // Internal Communication, the panel's own (V5): its banner and entries, and no composer (gap table row 42).
  const log = useSubmittalPanelLog({ item, locale, outcomes: typeOutcomes.map((o) => ({ ...o, type: item.type.code })) });
  const chat = useSubmittalPanelChatTab({ item, locale, refreshKey: null });

  const events = history?.events ?? [];
  const entries = workItemHistoryEntries({ events, viewerCompany: me.company.legalName, outcomes: typeOutcomes });
  const result = workItemCodeResult(events, item.outcome);
  const number = submittalPanelNumber(item.documentNumber, item.revisionNo);
  const open = isOpenStageCategory(item.stage.category);
  const outcomeName = item.outcome ? (typeOutcomes.find((o) => o.code === item.outcome)?.name[locale] ?? item.outcome) : null;
  const n = (value: number) => formatNumber(value, locale);
  const historyDetails = useHistoryDetails(props.schema, props.optionLists, documents, locale);

  const historyList = (
    <WorkItemPageHistory
      locale={locale}
      labels={{
        title: t("history.title"),
        move: (e) => historyMoveLabel(e, locale, tHistory),
        texts: { coverNote: tLog("coverNote"), remarks: tLog("remarks"), internalNote: tLog("internalNote"), reason: tLog("reason") },
        internal: tHistory("internal"),
        details: t("history.details"),
        empty: t("history.empty"),
      }}
      entries={entries}
      details={historyDetails}
    />
  );
  const railLabels = { workflow: tLog("workflow"), map: tLog("map"), log: t("history.title") };

  // The Transitions the viewer may take, each with its Review Code's tile; Pick up beside them.
  const busy = opener.calls.pending || opener.waiting;
  const transitionButtons = (
    <>
      {item.actions.transitions.map((tr) => (
        <Button
          key={tr.key}
          variant={codes[tr.key] || backwardKinds.includes(tr.kind) ? "secondary" : "primary"}
          disabled={busy}
          aria-busy={opener.waiting || undefined}
          onClick={() => opener.open(tr)}
          className="gap-2"
        >
          {codes[tr.key] && <CodeTile code={codes[tr.key]!} />}
          {tr.label[locale]}
        </Button>
      ))}
      {item.actions.pickUp && (
        <Button disabled={opener.calls.pending} onClick={() => void opener.calls.send("pick-up")} className="gap-2">
          {tItems("actions.pickUp")}
        </Button>
      )}
    </>
  );
  const hasTransitions = item.actions.transitions.length > 0 || item.actions.pickUp;

  // Who it is with, as the viewer may know it (V14): their own person, their pool's names, or another Company's name.
  const held = item.heldBy;
  const mine = held?.memberName && sameName(held.memberName, me.member.fullName);
  const pool = held?.pool && held.pool.names.length > 0 ? held.pool.names : null;
  const holderText = !held
    ? null
    : held.memberName
      ? mine
        ? t("actions.you", { name: held.memberName[locale] })
        : held.memberName[locale]
      : pool
        ? tItems("fields.notPickedUpYet", {
            company: held.companyName[locale],
            names: sortedByName(pool, (p) => p[locale], locale)
              .slice(0, 3)
              .map((p) => p[locale])
              .join(locale === "ar" ? "، " : ", "),
            more: Math.max(pool.length - 3, 0),
            n: n(Math.max(pool.length - 3, 0)),
          })
        : held.companyName[locale];
  const anotherCompany = held && !held.memberName && !pool;
  const attention = form?.editable ? form.errors.length : 0;

  const actionsCard = (rail: boolean) => (
    <WorkItemActionsCard
      title={t("actions.title")}
      with={{
        step: item.outcome ? `${outcomeName} · ${item.outcome}` : item.step.name[locale],
        holder: item.outcome ? t("actions.ended") : holderText,
        ...(item.outcome ? { code: item.outcome } : held?.memberName ? { avatar: held.memberName[locale] } : {}),
        ...(pool ? { unclaimed: true } : {}),
        ...(item.actions.returnToPool
          ? {
              end: (
                <Button variant="ghost" size="sm" disabled={opener.calls.pending} onClick={() => void opener.calls.send("return-to-pool")}>
                  {tItems("actions.returnToPool")}
                </Button>
              ),
            }
          : {}),
      }}
      // Under 880px the Transitions are the bottom bar's; the in-flow card holds only who it is with (gap table row 28).
      {...(rail && hasTransitions ? { transitions: transitionButtons } : {})}
      {...(attention > 0 ? { attention: t("actions.attention", { count: attention, n: n(attention) }) } : {})}
      {...(item.actions.pickUp
        ? { none: t("actions.pickUpHelp") }
        : !hasTransitions && !item.outcome && anotherCompany
          ? { none: t("actions.none", { company: held.companyName[locale] }) }
          : {})}
      {...(item.actions.createRevision && item.outcome
        ? {
            revision: {
              title: tRevision("create"),
              text: t("actions.revisionText", { code: item.outcome, n: n(item.revisionNo + 1) }),
              action: <CreateRevisionButton workItemId={item.id} />,
            },
          }
        : {})}
      footer={
        <>
          {item.actions.discardRevision && <WorkItemRevision workItemId={item.id} projectId={item.projectId} canCreate={false} canDiscard />}
          {rail && <OpenerAlert opener={opener} />}
        </>
      }
    />
  );

  // The Form tab: the Form's sections fold, between the page's own cards (gap table rows 22, 43–53).
  const sectionLabels = { count: (value: string, count: number) => tDetails("sectionCount", { count, n: value }), collapseAll: tDetails("collapseAll"), expandAll: tDetails("expandAll") };
  const lead: SubmittalPanelSectionItem[] = [
    {
      key: "workflow",
      icon: "route",
      title: t("workflowSection"),
      summary: t("workflowSummary", { count: entries.length, n: n(entries.length) }),
      children: <SubmittalPanelWorkflowAndLog labels={railLabels} workflow={workflow} onOpenMap={openMap} log={historyList} />,
      inflowOnly: true,
    },
    { key: "details", icon: "info-circle", title: t("details"), summary: [item.type.name[locale], item.raisedBy.companyName[locale]].join(" · "), children: details },
  ];
  const fileCount = documents.documents.filter((d) => d.fieldKey === null).length;
  const tail: SubmittalPanelSectionItem[] = [
    {
      key: "attachments",
      icon: "paperclip",
      title: tItems("attachments.title"),
      summary: t("attachmentsSummary", { count: fileCount, n: n(fileCount) }),
      children: <WorkItemAttachments workItemId={item.id} list={documents} locale={locale} />,
    },
    {
      key: "links",
      icon: "link",
      title: tItems("links.title"),
      summary: t("linksSummary", { count: links.links.length, n: n(links.links.length), from: n(linkedFrom.length) }),
      children: (
        <WorkItemLinks workItemId={item.id} projectId={item.projectId} list={links} locale={locale} questionLabels={questionLabels}>
          <WorkItemLinkedFrom items={[...linkedFrom]} />
        </WorkItemLinks>
      ),
    },
  ];
  const formTab = (
    <WorkItemAnswers
      locale={locale}
      workItemId={item.id}
      documents={documents}
      replyChecklists={replyChecklists}
      folding={{ lead, tail, labels: sectionLabels, nothing: t("nothingAnswered"), folded: ["details"] }}
    />
  );
  const tabs = [
    { key: "form", label: t("form"), content: formTab },
    chat,
    ...(log.internal ? [{ key: "internal", label: tDetails("internal"), icon: "lock" as const, count: log.internal.count, content: log.internal.content }] : []),
  ];

  // The bottom bar: Save Draft and the saved time while editing (every width), the Transitions under 880px.
  const save = form && form.editable ? saveButton({ documentNumber: form.documentNumber, dirty: form.dirty, pending: form.pending }) : null;
  const watchCall: WatchCall = async (on) => {
    const res = await fetch(`/api/v1/work-items/${item.id}/watch`, { method: on ? "PUT" : "DELETE" });
    if (res.ok) return { ok: true };
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: error ?? "unavailable" };
  };

  return (
    <>
      <WorkItemPageFrame
        locale={locale}
        back={list}
        linkAs={Link}
        crumb={
          number === null ? (
            tFacts("noNumber")
          ) : number.revisionNo === null ? (
            <DocNo value={number.number} />
          ) : (
            <DocNo value={number.number} rev={n(number.revisionNo)} locale={locale} />
          )
        }
        topBarEnd={
          <>
            {/* The viewer's own Watch only: no list or count of watchers anywhere. */}
            {watch && (
              <WatchButton
                look="topBar"
                labels={{ watch: tWatch("watch"), watching: tWatch("watching"), refusals: { not_found: tWatch("notFound"), unavailable: tWatch("unavailable") } }}
                watching={watch.watching}
                onChange={watchCall}
              />
            )}
            <WorkItemTopBarButton icon="route" label={tMap("view")} onClick={openMap} />
            {/* Its Documental Record once closed, its Working Copy while open (V7). */}
            {item.outcome ? <DownloadRecordButton workItemId={item.id} status={item.documentalRecord} /> : <DownloadWorkingCopyButton workItemId={item.id} />}
          </>
        }
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={number}
            noNumber={item.revisionNo > 0 ? tViews("list.revisionNoNumber", { revision: n(item.revisionNo) }) : tFacts("noNumber")}
            subject={item.title}
            numberInfo={
              <span className="flex flex-wrap items-center gap-2.5">
                {number && <SubmittalPanelNumber item={item} locale={locale} place={[]} />}
                {chain && (
                  <RevisionMenu
                    locale={locale}
                    labels={{
                      title: t("revisions.title"),
                      open: t("revisions.open"),
                      name: (revisionNo, hasNumber) => (revisionNo > 0 ? t("revisions.revision", { n: n(revisionNo) }) : hasNumber ? t("revisions.original") : t("revisions.draft")),
                      noNumber: (revisionNo) => (revisionNo > 0 ? tViews("list.revisionNoNumber", { revision: n(revisionNo) }) : tItems("noNumber")),
                    }}
                    revisions={chain.revisions}
                    currentId={item.id}
                    onOpen={(id) => router.push(`/work-items/${id}`)}
                  />
                )}
              </span>
            }
            chips={
              <>
                <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} />
                {/* The Issued Code only; a Recommended Code is never shown here (V5). */}
                {item.outcome && <Outcome outcome={item.outcome} typeCode={item.type.code} outcomes={typeOutcomes} locale={locale} cancelled={watchOutcomeNames.cancelled[locale]} />}
                <TradeChip code={item.trade.code} name={item.trade.name[locale]} />
                {/* Step Age in weeks while it waits at a Step; never days, never a due date. */}
                {open && item.stepAgeWeeks !== null && <StepAgePill weeks={item.stepAgeWeeks} locale={locale} />}
              </>
            }
          />
        }
        route={route}
        facts={
          <SubmittalPanelFacts
            locale={locale}
            labels={{ with: tFacts("with"), stepAge: tFacts("stepAge"), location: tFacts("location"), more: (value) => tFacts("more", { n: value }), none: "—" }}
            with={item.outcome ? null : submittalPanelWith(item.heldBy, locale)}
            stepAgeWeeks={null}
            place={item.location ? [item.location.name[locale]] : []}
            step={{ label: tItems("fields.step"), name: item.outcome ? null : item.step.name[locale] }}
          />
        }
        lead={
          <>
            {result && (
              <div className="mx-5 mt-3.5 @[880px]/sdp:mx-7">
                <WorkItemResultCard
                  code={result.code}
                  title={outcomeName ?? result.code}
                  issued={t("result.issued", { date: formatDate(new Date(result.at), locale, { dateStyle: "medium", timeStyle: "short" }) })}
                  remarks={result.remarks}
                  signedBy={t("result.signedBy")}
                  signer={result.signer?.[locale] ?? null}
                  company={result.company?.[locale] ?? null}
                />
              </div>
            )}
            {/* Under 880px the Actions card sits in the flow; from 880px it is the rail's. */}
            <div className="sdp-inflow px-5 pt-3.5">{actionsCard(false)}</div>
            {notices && <div className="flex flex-col gap-3 px-5 pt-3.5 empty:hidden @[880px]/sdp:px-7">{notices}</div>}
            {!hasTransitions && <OpenerAlert opener={opener} className="px-5 pt-3" />}
          </>
        }
        railLabel={t("rail")}
        rail={
          <>
            {actionsCard(true)}
            <SubmittalPanelRail labels={railLabels} workflow={workflow} onOpenMap={openMap} log={historyList} />
          </>
        }
        bar={{
          label: t("actions.bar"),
          ...(save && form
            ? {
                start: (
                  <span className="flex flex-wrap items-center gap-3">
                    <SaveStatus locale={locale} savedAt={form.savedAt} changedByOthers={[]} />
                    <Button
                      variant="secondary"
                      disabled={save.disabled}
                      onClick={() => void (save.closes ? form.save(true).then((ok) => ok && router.push(`/projects/${item.projectId}/work-items`)) : form.save(false))}
                    >
                      {tItems(`form.${save.label}`)}
                    </Button>
                  </span>
                ),
              }
            : {}),
          ...(hasTransitions ? { transitions: transitionButtons } : {}),
        }}
      >
        <SubmittalPanelTabs locale={locale} label={tDetails("tabs")} tabs={tabs} value={tabs.some((x) => x.key === tab) ? tab : "form"} onValueChange={setTab} />
      </WorkItemPageFrame>
      {opener.dialogs}
    </>
  );
}

const sameName = (a: { en: string; ar: string }, b: { en: string; ar: string }) => a.en === b.en && a.ar === b.ar;

// Answers that hold ids (Built-in Fields, people and Companies) are named only on the Form itself.
const idTypes = new Set(["trade", "location", "scopes", "member", "participant", "approved_supplier", "checklist_template"]);
const ownLines: ReadonlySet<string> = new Set(["reason", "remarks"]);

/**
 * An entry's further details, folded behind "Details" in the History (gap table row 64), as the old
 * page listed them: its Step move (the viewer's own Participant's only, as the read gives it), the
 * number it got, a reply's answers and files, a Recommended Code (inside its Participant, V5) and the
 * fields it changed. Nothing the read doesn't give.
 */
function useHistoryDetails(schema: FormSchema, optionLists: readonly OptionList[], documents: DocumentList, locale: Locale) {
  const t = useTranslations("workItems.history");
  const fields = new Map(answerFields(schema).map((f) => [f.key, f]));
  const arrow = locale === "ar" ? "←" : "→";
  const value = (key: string, v: unknown) => {
    const field = fields.get(key);
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return t("emptyAnswer");
    return field ? formatFormValue(field, v, locale, undefined, optionLists) : String(v);
  };
  const linksText = (v: unknown) => {
    const parsed = linksChangeValue.safeParse(v);
    if (!parsed.success || parsed.data.length === 0) return t("emptyAnswer");
    return parsed.data.map((l) => `\u2066${l.documentNumber}\u2069 ${l.subject}`).join(", ");
  };
  const byId = new Map(documents.documents.map((d) => [d.id, d]));
  return (entry: WorkItemHistoryEntry): ReactNode => {
    const e: Event = entry.event;
    const lines: ReactNode[] = [];
    if (e.fromStep && e.toStep) lines.push(<p key="steps">{`${e.fromStep[locale]} ${arrow} ${e.toStep[locale]}`}</p>);
    if (e.documentNumber)
      lines.push(
        <p key="number">
          {t("numbered")} <DocNo value={e.documentNumber} />
        </p>,
      );
    if (e.answers && e.answersForm) {
      for (const f of answerFields(e.answersForm)) {
        const v = e.answers[f.key];
        if (ownLines.has(f.key) || f.key === "cover_note" || v === undefined || v === null || v === "") continue;
        lines.push(
          <p key={`answer-${f.key}`}>
            <span className="font-semibold">{f.label[locale]}:</span> <bdi>{formatFormValue(f, v, locale, undefined, optionLists)}</bdi>
          </p>,
        );
      }
    }
    const taken = (e.files ?? []).flatMap((id) => byId.get(id) ?? []);
    if (taken.length > 0)
      lines.push(
        <p key="files">
          <span className="font-semibold">{t("files")}:</span> <bdi>{taken.map((d) => d.fileName).join(", ")}</bdi>
        </p>,
      );
    if (e.recommendedCode)
      lines.push(
        <p key="recommended">
          <span className="font-semibold">{t("recommendedCode")}:</span> {e.recommendedCode}
        </p>,
      );
    for (const change of e.changes ?? []) {
      const field = fields.get(change.field);
      const text =
        change.field === linksChangeField
          ? `${t("linksField")}: ${linksText(change.old)} ${arrow} ${linksText(change.new)}`
          : field && idTypes.has(field.type)
            ? `${field.label[locale]}: ${t("changedValue")}`
            : `${field?.label[locale] ?? change.field}: ${value(change.field, change.old)} ${arrow} ${value(change.field, change.new)}`;
      lines.push(
        <p key={`change-${change.field}`}>
          <bdi>{text}</bdi>
        </p>,
      );
    }
    return lines.length > 0 ? <>{lines}</> : null;
  };
}
