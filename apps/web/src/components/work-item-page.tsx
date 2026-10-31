"use client";

import {
  backwardKinds,
  formatDate,
  formatFormValue,
  formatNumber,
  isOpenStageCategory,
  offersRevision,
  outcomeLook,
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
  Badge,
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
  WorkItemTransitionsCard,
  WorkItemPageFrame,
  WorkItemPageHistory,
  WorkItemIssuedCodeCard,
  WorkItemTopBarButton,
  coverNoteKey,
  outcomesOfType,
  sameName,
  stageColour,
  submittalPanelNumber,
  submittalPanelWith,
  transitionCodes,
  workItemIssuedCode,
  workItemHistoryEntries,
  type SubmittalPanelSectionItem,
  type WorkItemHistoryEntry,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useRecordDownload } from "@/components/download-record-button";
import { useWorkingCopyDownload } from "@/components/download-working-copy-button";
import { CreateRevisionButton } from "@/components/submittal-panel-host";
import { useSubmittalPanelChatTab } from "@/components/submittal-panel-chat";
import { useSubmittalPanelLog } from "@/components/submittal-panel-log";
import { SubmittalPanelNumber } from "@/components/submittal-panel-number";
import { useSubmittalPanelRoute } from "@/components/submittal-panel-route";
import { OpenerAlert, useTransitionOpener } from "@/components/work-item-actions";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, useSaveDraft, useWorkItemForm } from "@/components/work-item-form";
import { WorkItemLinkedFrom } from "@/components/work-item-linked-from";
import { WorkItemLinks } from "@/components/work-item-links";
import { WorkItemWatch } from "@/components/work-item-watch";
import { WorkItemRevision } from "@/components/work-item-revision";
import { Link, useRouter } from "@/i18n/navigation";
import type { AnsweredChecklists } from "@/lib/checklist-once";
import { changeText, replyAnswers, replyFiles } from "@/lib/history-details";
import { historyMoveLabel } from "@/lib/history-move-label";
import { notPickedUpYetValues } from "@/lib/pool-line";
import { transitionGoesTo } from "@/lib/transition-goes-to";


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
  const tMap = useTranslations("workflowMap");
  const tViews = useTranslations("workItemViews");
  const tRevision = useTranslations("revision");
  const tPopup = useTranslations("workItems.actions.popup");
  const form = useWorkItemForm();
  const router = useRouter();
  const [tab, setTab] = useState("form");

  const typeOutcomes = outcomesOfType(item.type.code, [...outcomes]);
  const codes = transitionCodes(item.actions.transitions, workflowMap?.definition ?? null);
  // A code's colour: its place in its Type's set, as the Kanban and the panel colour it.
  const lookOf = (code: string) => {
    const outcome = typeOutcomes.find((o) => o.code === code);
    return outcome ? outcomeLook(outcome, typeOutcomes) : undefined;
  };
  // The pop-up's header (rows 34–36): the raiser's Company reads the Remarks with the signer's name (V14:
  // the final outcome and its signer are shown), unless the viewer is of the raiser's Company.
  const raiser = item.raisedBy.companyName;
  const raisedByOwn = sameName(raiser, me.company.legalName);
  const opener = useTransitionOpener(item.id, item.actions, locale, (tr) => {
    const code = codes[tr.key] ?? null;
    const outcome = code ? typeOutcomes.find((o) => o.code === code) : undefined;
    const goes = raisedByOwn ? null : transitionGoesTo({ kind: tr.kind, offersRevision: outcome ? offersRevision(outcome) : false });
    return {
      code,
      look: code ? lookOf(code) : undefined,
      documentNumber: item.documentNumber,
      goesTo: goes === "back" ? tPopup("goesBackTo", { company: raiser[locale] }) : goes === "closes" ? tPopup("closesFor", { company: raiser[locale] }) : null,
      remarksReader: raisedByOwn ? null : raiser[locale],
      ownCompany: me.company.legalName[locale],
    };
  });
  const { route, workflow, openMap } = useSubmittalPanelRoute(item, locale);
  // Download PDF: the Documental Record once closed, the Working Copy while open (V7).
  const record = useRecordDownload(item.id, item.documentalRecord);
  const workingCopy = useWorkingCopyDownload(item.id);
  const pdf = item.outcome ? record : workingCopy;
  // Internal Communication, the panel's own (V5): its banner and entries, and no composer (gap table row 42).
  const log = useSubmittalPanelLog({ item, locale, outcomes: typeOutcomes.map((o) => ({ ...o, type: item.type.code })) });
  const chat = useSubmittalPanelChatTab({ item, locale, refreshKey: null });

  const events = history?.events ?? [];
  const entries = workItemHistoryEntries({ events, viewerCompany: me.company.legalName, outcomes: typeOutcomes });
  const result = workItemIssuedCode(events, item.outcome);
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
        you: (name) => t("actions.you", { name }),
        empty: t("history.empty"),
      }}
      entries={entries}
      details={historyDetails}
      viewer={me.member.fullName}
    />
  );
  const railLabels = { workflow: tLog("workflow"), map: tLog("map"), log: t("history.title") };

  // The Transitions the viewer may take, each with its Review Code's tile; Pick up beside them.
  const busy = opener.calls.pending || opener.waiting;
  // The code a checklist proposes (RP-86, ADR 0025) is the one marked and filled; the other codes stay offered.
  const proposing = item.actions.transitions.some((tr) => tr.proposed);
  const transitionButtons = (
    <>
      {item.actions.transitions.map((tr) => (
        <Button
          key={tr.key}
          variant={backwardKinds.includes(tr.kind) || (proposing ? !tr.proposed : codes[tr.key] !== undefined) ? "secondary" : "primary"}
          disabled={busy}
          aria-busy={opener.waiting || undefined}
          onClick={() => opener.open(tr)}
          className="gap-2"
        >
          {codes[tr.key] && <CodeTile code={codes[tr.key]!} look={lookOf(codes[tr.key]!)} />}
          {tr.label[locale]}
          {tr.proposed && <Badge tone="neutral">{tItems("actions.proposed")}</Badge>}
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
        ? tItems("fields.notPickedUpYet", notPickedUpYetValues(held.companyName, pool, locale))
        : held.companyName[locale];
  const anotherCompany = held && !held.memberName && !pool;
  const attention = form?.editable ? form.errors.length : 0;

  const transitionsCard = (rail: boolean) => (
    <WorkItemTransitionsCard
      title={t("actions.title")}
      with={{
        step: item.outcome ? `${outcomeName} · ${item.outcome}` : item.step.name[locale],
        holder: item.outcome ? t("actions.ended") : holderText,
        ...(item.outcome ? { code: item.outcome, look: lookOf(item.outcome) } : held?.memberName ? { avatar: held.memberName[locale] } : {}),
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
        : !hasTransitions && !item.outcome && held && !mine
          ? { none: anotherCompany ? t("actions.none", { company: held.companyName[locale] }) : t("actions.noneHere") }
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
          {item.actions.discardRevision && <WorkItemRevision workItemId={item.id} projectId={item.projectId} canCreate={false} canDiscard look="page" />}
          <OpenerAlert opener={opener} />
        </>
      }
    />
  );

  // The Form tab: the Form's sections fold, between the page's own cards (gap table rows 22, 43–53).
  // "8 sections · Read-only", or "· Editing" while the viewer may change it (gap table row 43).
  const sectionLabels = { count: (value: string, count: number) => `${tDetails("sectionCount", { count, n: value })} · ${form?.editable ? t("editing") : t("readOnly")}`, collapseAll: tDetails("collapseAll"), expandAll: tDetails("expandAll") };
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
      children: <WorkItemAttachments workItemId={item.id} list={documents} locale={locale} titleHidden look="chips" />,
    },
    {
      key: "links",
      icon: "link",
      title: tItems("links.title"),
      summary: t("linksSummary", { count: links.links.length, n: n(links.links.length), from: n(linkedFrom.length) }),
      children: (
        <WorkItemLinks workItemId={item.id} projectId={item.projectId} list={links} locale={locale} questionLabels={questionLabels} titleHidden look="rows">
          <WorkItemLinkedFrom items={[...linkedFrom]} look="rows" />
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
    ...(log.internal ? [{ key: "internal", label: tDetails("internal"), shortLabel: t("internalShort"), icon: "lock" as const, count: log.internal.count, content: log.internal.content }] : []),
  ];

  // The bottom bar: Save Draft and the saved time while editing (every width), the Transitions under 880px.
  const saveDraft = useSaveDraft(locale);
  const save = form?.editable ? saveDraft : null;

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
              <WorkItemWatch workItemId={item.id} watching={watch.watching} look="topBar" />

            )}
            <WorkItemTopBarButton icon="route" label={tMap("view")} onClick={openMap} />
            {/* Its Documental Record once closed, its Working Copy while open (V7): by its icon only under 560px (row 6). */}
            {(item.outcome ? record.canDownload : true) && (
              <WorkItemTopBarButton icon="download" label={pdf.label} onClick={() => void pdf.download()} disabled={!item.outcome && workingCopy.pending} />
            )}
          </>
        }
        // Its message under the top bar, which keeps its 52px (row 6).
        topBarStatus={pdf.message}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={number}
            noNumber={item.revisionNo > 0 ? tViews("list.revisionNoNumber", { revision: n(item.revisionNo) }) : tFacts("noNumber")}
            subject={item.title}
            subjectAs="h1"
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
              <div className="wip-lead mx-5 mt-[14px] @[880px]/sdp:mx-7">
                <WorkItemIssuedCodeCard
                  code={result.code}
                  look={lookOf(result.code)}
                  title={outcomeName ?? result.code}
                  issued={t("issuedCode.issued", { date: formatDate(new Date(result.at), locale, { dateStyle: "medium", timeStyle: "short" }) })}
                  remarks={result.remarks}
                  signedBy={t("issuedCode.signedBy")}
                  signer={result.signer?.[locale] ?? null}
                  company={result.company?.[locale] ?? null}
                />
              </div>
            )}
            {/* Under 880px the Actions card sits in the flow; from 880px it is the rail's. */}
            <div className="sdp-inflow px-5 pt-[14px]">{transitionsCard(false)}</div>
            {notices && <div className="wip-lead flex flex-col gap-3 px-5 pt-[14px] empty:hidden @[880px]/sdp:px-7">{notices}</div>}
          </>
        }
        railLabel={t("rail")}
        rail={
          <>
            {transitionsCard(true)}
            <SubmittalPanelRail labels={railLabels} workflow={workflow} onOpenMap={openMap} log={historyList} />
          </>
        }
        bar={{
          label: t("actions.bar"),
          ...(save && form
            ? {
                start: (
                  <span className="flex flex-wrap items-center gap-3">
                    <SaveStatus locale={locale} savedAt={form.savedAt} changedByOthers={save.changedByOthers} />
                    <Button variant="secondary" disabled={save.button.disabled} onClick={() => void save.run()}>
                      {tItems(`form.${save.button.label}`)}
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



/** The Cover Note shows as the entry's own text, so its details don't repeat it. */
const shownAsText: ReadonlySet<string> = new Set([coverNoteKey]);

/**
 * An entry's further details, folded behind "Details" in the History (gap table row 64), as the old
 * page lists them (`lib/history-details.ts`, shared with it): its Step move (the viewer's own
 * Participant's only, as the read gives it), the number it got, a reply's answers and files, a
 * Recommended Code (inside its Participant, V5) and the fields it changed. Nothing the read doesn't give.
 */
function useHistoryDetails(schema: FormSchema, optionLists: readonly OptionList[], documents: DocumentList, locale: Locale) {
  const t = useTranslations("workItems.history");
  const words = { emptyAnswer: t("emptyAnswer"), changedValue: t("changedValue"), linksField: t("linksField"), files: t("files") };
  const arrow = locale === "ar" ? "←" : "→";
  return (entry: WorkItemHistoryEntry): ReactNode => {
    const e = entry.event;
    const lines: ReactNode[] = [];
    if (e.fromStep && e.toStep) lines.push(<p key="steps">{`${e.fromStep[locale]} ${arrow} ${e.toStep[locale]}`}</p>);
    if (e.documentNumber)
      lines.push(
        <p key="number">
          {t("numbered")} <DocNo value={e.documentNumber} />
        </p>,
      );
    for (const [field, v] of replyAnswers(e, shownAsText))
      lines.push(
        <p key={`answer-${field.key}`}>
          <span className="font-semibold">{field.label[locale]}:</span> <bdi>{formatFormValue(field, v, locale, undefined, optionLists)}</bdi>
        </p>,
      );
    for (const [label, names] of replyFiles(e, documents.documents, locale, words))
      lines.push(
        <p key={`files-${label}`}>
          <span className="font-semibold">{label}:</span> <bdi>{names.join(", ")}</bdi>
        </p>,
      );
    if (e.recommendedCode)
      lines.push(
        <p key="recommended">
          <span className="font-semibold">{t("recommendedCode")}:</span> {e.recommendedCode}
        </p>,
      );
    for (const change of e.changes ?? [])
      lines.push(
        <p key={`change-${change.field}`}>
          <bdi>{changeText(change, schema, optionLists, locale, words)}</bdi>
        </p>,
      );
    return lines.length > 0 ? <>{lines}</> : null;
  };
}
