import { directionOf, formatNumber, type BilingualText, type Locale, type WorkItemHistory } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { SubmittalPanelRail, SubmittalPanelWorkflowAndLog } from "./panel-rail.tsx";
import { SubmittalPanelSizeSwitch, useSubmittalPanelSize, type SubmittalPanelSizeLabels } from "./panel-resize.tsx";
import { SubmittalPanelFields, SubmittalPanelSections } from "./panel-sections.tsx";
import { SubmittalPanelTabs } from "./panel-tabs.tsx";
import { SubmittalApprovalLog, SubmittalInternalCommunication, type SubmittalTimelineLabels } from "./panel-timeline.tsx";
import { submittalApprovalLog, submittalInternalLog, type SubmittalTimelineEvent } from "./timeline-model.ts";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

/*
 * The approval log and Internal Communication (RP-1067, README §5, gaps A6–A9): one timeline, in the
 * side rail from 880px and in the in-flow "Workflow & approval log" section below. Each viewer's
 * stories are fed the history exactly as the read gives it to them (V5, V14): the Contractor's holds
 * its own internal events and the shared ones, the Consultant's its own and the shared ones.
 */

const bi = (en: string, ar: string): BilingualText => ({ en, ar });

const contractor = bi("TMC Constructions", "تي إم سي للمقاولات");
const consultant = bi("Design Consultants LLC", "ديزاين للاستشارات");
const sara = bi("Sara Al Harbi", "سارة الحربي");
const faisal = bi("Faisal Al Qahtani", "فيصل القحطاني");
const khalid = bi("Khalid Al Shehri", "خالد الشهري");
const omar = bi("Omar Haddad", "عمر حداد");

type Event = WorkItemHistory["events"][number];
type Over = Partial<Event> & Pick<Event, "type" | "audience" | "at">;

/** A viewer's history: events numbered 1, 2, 3… as that viewer sees them, never the stored seq. */
const history = (events: Over[]): Event[] =>
  events.map((over, i) => ({
    seq: i + 1,
    by: { companyName: null, memberName: null },
    transition: null,
    fromStep: null,
    toStep: null,
    reason: null,
    remarks: null,
    documentNumber: null,
    outcome: null,
    internalNote: null,
    recommendedCode: null,
    changes: null,
    handover: null,
    answers: null,
    ...over,
  }));

const submitText = bi("Submit to Consultant", "إحالة إلى الاستشاري");
const coverNote = { cover_note: "Lighting fixtures for Level 3, datasheets attached." };
const sendBack = bi("Send Back", "إعادة");
const codeB = bi("Code B: Approved with Comments", "الرمز B: معتمد مع ملاحظات");
const remarks = "Use the revised fixing detail on sheet E-204.";

/** As the read gives it to the Contractor (TMC): its own internal moves, and the shared ones; the Consultant by name only, but for the Code's signer. */
const contractorHistory = history([
  { type: "transition", audience: "internal", at: "2026-10-05T07:10:00Z", transition: bi("Send for review", "إرسال للمراجعة"), by: { companyName: contractor, memberName: sara } },
  { type: "internal_note", audience: "internal", at: "2026-10-06T08:00:00Z", transition: submitText, internalNote: "Checked against the spec, section 26 51 00.", by: { companyName: contractor, memberName: faisal } },
  { type: "transition", audience: "shared", at: "2026-10-06T08:00:00Z", transition: submitText, answers: coverNote, by: { companyName: contractor, memberName: faisal } },
  { type: "transition", audience: "shared", at: "2026-10-12T11:30:00Z", transition: sendBack, reason: "The datasheet is for another model.", by: { companyName: consultant, memberName: null } },
  { type: "transition", audience: "internal", at: "2026-10-13T06:45:00Z", transition: bi("Return", "إرجاع"), reason: "Attach the 4000K datasheet.", by: { companyName: contractor, memberName: faisal } },
  { type: "transition", audience: "shared", at: "2026-10-14T09:20:00Z", transition: submitText, by: { companyName: contractor, memberName: faisal } },
  { type: "issue_code", audience: "shared", at: "2026-10-20T13:05:00Z", transition: codeB, outcome: "B", remarks, by: { companyName: consultant, memberName: omar } },
]);

/** As the read gives it to the Consultant (Design Consultants): the Contractor by name only, its own people and internal moves. */
const consultantHistory = history([
  { type: "transition", audience: "shared", at: "2026-10-06T08:00:00Z", transition: submitText, answers: coverNote, by: { companyName: contractor, memberName: null } },
  { type: "picked_up", audience: "internal", at: "2026-10-07T07:00:00Z", by: { companyName: consultant, memberName: khalid } },
  { type: "recommend_code", audience: "internal", at: "2026-10-09T10:15:00Z", recommendedCode: "C", by: { companyName: consultant, memberName: khalid } },
  { type: "transition", audience: "shared", at: "2026-10-12T11:30:00Z", transition: sendBack, reason: "The datasheet is for another model.", by: { companyName: consultant, memberName: omar } },
  { type: "transition", audience: "shared", at: "2026-10-14T09:20:00Z", transition: submitText, by: { companyName: contractor, memberName: null } },
  { type: "internal_note", audience: "internal", at: "2026-10-16T08:40:00Z", transition: bi("Send to Manager", "إرسال إلى المدير"), internalNote: "Fixings differ from E-204.", by: { companyName: consultant, memberName: khalid } },
  { type: "recommend_code", audience: "internal", at: "2026-10-16T08:40:00Z", recommendedCode: "B", by: { companyName: consultant, memberName: khalid } },
  { type: "issue_code", audience: "shared", at: "2026-10-20T13:05:00Z", transition: codeB, outcome: "B", remarks, by: { companyName: consultant, memberName: omar } },
]);

const reviewCodes = [
  { code: "A", polarity: "positive" as const, actions: [] },
  { code: "B", polarity: "positive" as const, actions: [{ kind: "create_items" as const, type: "CMT" }] },
  { code: "C", polarity: "negative" as const, actions: [{ kind: "offer_revision" as const }] },
  { code: "D", polarity: "negative" as const, actions: [{ kind: "offer_replacement" as const }] },
];

type Viewer = {
  company: BilingualText;
  role: "contractor" | "consultant";
  events: Event[];
  /** The Creation Date: the item read gives it to the raiser's Participant only. */
  creationDate: string | null;
  /** The Comments raised from it the viewer sees (`raisedItems`). */
  comments: number;
};
const viewers: Record<"contractor" | "consultant", Viewer> = {
  contractor: { company: contractor, role: "contractor", events: contractorHistory, creationDate: "2026-10-05T07:10:00Z", comments: 3 },
  consultant: { company: consultant, role: "consultant", events: consultantHistory, creationDate: null, comments: 3 },
};

const copy = {
  module: bi("Submittals", "التقديمات"),
  previous: bi("Previous submittal", "التقديم السابق"),
  next: bi("Next submittal", "التقديم التالي"),
  close: bi("Close", "إغلاق"),
  hint: bi("Esc to close · ↑ ↓ to move through the list", "Esc للإغلاق · ↑ ↓ للتنقل في القائمة"),
  tabs: bi("Submittal", "التقديم"),
  details: bi("Details", "التفاصيل"),
  internal: bi("Internal Communication", "التواصل الداخلي"),
  collapseAll: bi("Collapse all", "طي الكل"),
  expandAll: bi("Expand all", "فتح الكل"),
  subject: bi("Subject", "الموضوع"),
  section: bi("Workflow & approval log", "سير العمل وسجل الاعتماد"),
  workflow: bi("Workflow", "سير العمل"),
  map: bi("Workflow map", "خريطة سير العمل"),
  log: bi("Approval log", "سجل الاعتماد"),
  created: bi("Created", "أُنشئ"),
  coverNote: bi("Cover Note", "ملاحظة الإحالة"),
  remarks: bi("Remarks", "الملاحظات"),
  internalNote: bi("Internal Note", "ملاحظة داخلية"),
  reason: bi("Reason", "السبب"),
  pickedUp: bi("Picked up", "تم الاستلام"),
  recommended: bi("Recommended Code", "الرمز الموصى به"),
  empty: bi("Nothing has happened between the Companies yet.", "لم يحدث شيء بين الشركات بعد."),
  stage: bi("Closed", "مغلق"),
  group: bi("Size", "الحجم"),
  compact: bi("Compact", "مضغوط"),
  normal: bi("Normal", "عادي"),
  wide: bi("Wide", "عريض"),
  full: bi("Full", "كامل"),
  grip: bi("Drag to resize · double-click to switch Normal and Wide", "اسحب لتغيير الحجم · انقر مرتين للتبديل بين عادي وعريض"),
};

const review = (company: string, locale: Locale) => (locale === "ar" ? `مراجعة ${company}` : `${company} review`);
const comments = (n: string, locale: Locale) => (locale === "ar" ? `${n} ملاحظات في قائمة الملاحظات` : `${n} Comments in the Snag List`);
const banner = (viewer: Viewer, locale: Locale) => {
  const others = { contractor: bi("the Consultant or the Owner", "للاستشاري أو المالك"), consultant: bi("the Contractor or the Owner", "للمقاول أو المالك") }[viewer.role];
  return locale === "ar"
    ? `داخلي: لا يراه إلا ${viewer.company.ar}. لا يظهر أبداً ${others.ar}.`
    : `Internal: only ${viewer.company.en} can see this. Never shown to ${others.en}.`;
};

function labelsFor(locale: Locale): SubmittalTimelineLabels {
  return {
    created: copy.created[locale],
    review: (company) => review(company, locale),
    move: (e: SubmittalTimelineEvent) => (e.transition ? e.transition[locale] : e.type === "picked_up" ? copy.pickedUp[locale] : copy.recommended[locale]),
    texts: { coverNote: copy.coverNote[locale], remarks: copy.remarks[locale], internalNote: copy.internalNote[locale], reason: copy.reason[locale] },
    comments: (n) => comments(n, locale),
    recommendedCode: (code) => `${copy.recommended[locale]} ${code}`,
    empty: copy.empty[locale],
  };
}

const sizeLabels = (locale: Locale): SubmittalPanelSizeLabels => ({
  group: copy.group[locale],
  sizes: { compact: copy.compact[locale], normal: copy.normal[locale], wide: copy.wide[locale], full: copy.full[locale] },
  grip: copy.grip[locale],
});

function TimelineDemo({ context, viewer, initial = 640 }: { context: StoryContext; viewer: Viewer; initial?: number }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const size = useSubmittalPanelSize({ initial, dir: directionOf(locale) });
  const [tab, setTab] = useState("details");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const labels = labelsFor(locale);
  const entries = submittalApprovalLog({
    events: viewer.events,
    viewerCompany: viewer.company,
    creationDate: viewer.creationDate,
    outcomes: reviewCodes,
    raisedItems: [{ type: { code: "CMT" }, open: 2, closed: viewer.comments - 2 }],
  });
  const internal = submittalInternalLog(viewer.events, reviewCodes);
  const railLabels = { workflow: copy.workflow[locale], map: copy.map[locale], log: copy.log[locale] };
  const log = <SubmittalApprovalLog locale={locale} labels={labels} entries={entries} commentsHref={() => "#snag-list"} />;
  return (
    <SubmittalPanel
      locale={locale}
      labels={{
        module: copy.module[locale],
        position: (n, total) => `${n} / ${total}`,
        previous: copy.previous[locale],
        next: copy.next[locale],
        close: copy.close[locale],
        hint: copy.hint[locale],
      }}
      crumb={<bdi dir="ltr">TWR-TMC-EL-MAR-042</bdi>}
      onClose={() => {}}
      width={size.width}
      resizing={size.resizing}
      topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels(locale)} />}
      labelledBy={ids.labelledBy}
      identity={
        <SubmittalPanelIdentity
          locale={locale}
          number={{ number: "TWR-TMC-EL-MAR-042", revisionNo: null }}
          noNumber=""
          subject={locale === "ar" ? "وحدات الإنارة للطابق الثالث" : "Lighting fixtures, Level 3"}
          numberId={ids.numberId}
          subjectId={ids.subjectId}
          chips={<StagePill stage="approved" label={copy.stage[locale]} />}
        />
      }
      tabs={
        <SubmittalPanelTabs
          locale={locale}
          label={copy.tabs[locale]}
          value={tab}
          onValueChange={setTab}
          tabs={[
            {
              key: "details",
              label: copy.details[locale],
              content: (
                <SubmittalPanelSections
                  locale={locale}
                  labels={{ count: (n) => (locale === "ar" ? `${n} أقسام` : `${n} sections`), collapseAll: copy.collapseAll[locale], expandAll: copy.expandAll[locale] }}
                  collapsed={collapsed}
                  onCollapsedChange={setCollapsed}
                  sections={[
                    {
                      key: "workflow",
                      icon: "route",
                      title: copy.section[locale],
                      summary: `${locale === "ar" ? "مغلق" : "Closed"} · ${formatNumber(entries.length, locale)}`,
                      children: <SubmittalPanelWorkflowAndLog labels={railLabels} log={log} onOpenMap={() => {}} />,
                      inflowOnly: true,
                    },
                    {
                      key: "subject",
                      icon: "file-text",
                      title: copy.subject[locale],
                      summary: "",
                      children: <SubmittalPanelFields fields={[{ key: "subject", label: copy.subject[locale], value: locale === "ar" ? "وحدات الإنارة للطابق الثالث" : "Lighting fixtures, Level 3", full: true }]} />,
                    },
                  ]}
                />
              ),
            },
            {
              key: "internal",
              label: copy.internal[locale],
              icon: "lock",
              count: internal.length,
              content: <SubmittalInternalCommunication locale={locale} labels={labels} banner={banner(viewer, locale)} entries={internal} />,
            },
          ]}
        />
      }
      rail={<SubmittalPanelRail labels={railLabels} log={log} onOpenMap={() => {}} />}
    />
  );
}

const meta = {
  title: "Views/Submittal Panel/Approval log",
  parameters: overlay,
  render: (_args, context) => <TimelineDemo context={context} viewer={viewers.contractor} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const shown = (el: Element | null) => el !== null && getComputedStyle(el).display !== "none";
const inflowOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>('[data-section="workflow"]')!;
const railOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>(".sdp-rail")!;
const textOf = (el: Element) => el.textContent ?? "";
const name = (context: PlayContext, text: BilingualText) => storyText(context, text);

/** No bubbles, no composer, no due dates anywhere in the panel. */
async function expectNoChat(context: PlayContext) {
  const panel = panelOf(context);
  await expect(panel.querySelector("input, textarea, [contenteditable]")).toBeNull();
  await expect(within(panel).queryByText(/due|overdue|استحقاق|Client/i)).toBeNull();
}

/**
 * Scenario RP-1067-1, as the Contractor, Normal (640px): the in-flow section holds the log, the rail
 * is hidden. The log names the Contractor's own people and the final Code's signer, never another
 * Consultant person; the Consultant's turns are one "Design Consultants LLC review" block each; no
 * Recommended Code. The raiser sees Created. Text boxes: the Cover Note and the Remarks only (the
 * Send Back's reason is not the log's). Code B's chip counts the 3 Comments the viewer sees.
 */
export const AsTheContractor: Story = {
  play: async (context) => {
    const section = inflowOf(context);
    await expect(shown(section)).toBe(true);
    await expect(shown(railOf(context))).toBe(false);
    const log = textOf(section);
    await expect(log).toContain(name(context, faisal));
    await expect(log).toContain(name(context, omar));
    await expect(log).not.toContain(name(context, khalid));
    await expect(log).not.toContain(name(context, copy.recommended));
    await expect(log).toContain(review(name(context, consultant), storyLocale(context)));
    await expect(within(section).getByText(name(context, copy.created))).toBeVisible();
    await expect([...section.querySelectorAll("[data-text]")].map((el) => el.getAttribute("data-text"))).toEqual([
      name(context, copy.remarks),
      name(context, copy.coverNote),
    ]);
    await expect(log).not.toContain("another model");
    const chip = section.querySelector<HTMLElement>('[data-chip="comments"]')!;
    await expect(chip).toHaveTextContent(comments("3", storyLocale(context)));
    await expect(chip.closest("a")?.getAttribute("href")).toBe("#snag-list");
    await expectNoChat(context);
  },
};

/** As the Contractor, Wide (960px): the rail shows the same log, the in-flow section is hidden and not counted. */
export const AsTheContractorWide: Story = {
  render: (_args, context) => <TimelineDemo context={context} viewer={viewers.contractor} initial={960} />,
  play: async (context) => {
    const rail = railOf(context);
    await expect(shown(rail)).toBe(true);
    await expect(shown(inflowOf(context))).toBe(false);
    await expect(textOf(rail)).toContain(name(context, copy.log));
    await expect(textOf(rail)).toContain(name(context, omar));
    await expect(within(panelOf(context)).getByText(storyLocale(context) === "ar" ? "1 أقسام" : "1 sections")).toBeVisible();
    // Live with the bands: back to Normal, the section is back and the rail gone.
    await userEvent.click(within(panelOf(context)).getByRole("button", { name: name(context, copy.normal) }));
    await waitFor(() => expect(shown(inflowOf(context))).toBe(true));
    await expect(shown(rail)).toBe(false);
  },
};

/**
 * Scenario RP-1067-2, as the Consultant: no Created (the Contractor's Creation Date is the raiser's
 * only; `AsTheContractor` is the positive control), and the log starts at the Submit. The Contractor
 * is named by its Company only; the Consultant's own people are named.
 */
export const AsTheConsultant: Story = {
  render: (_args, context) => <TimelineDemo context={context} viewer={viewers.consultant} />,
  play: async (context) => {
    const section = inflowOf(context);
    const log = textOf(section);
    await expect(within(section).queryByText(name(context, copy.created))).toBeNull();
    await expect(log).not.toContain(name(context, faisal));
    await expect(log).toContain(name(context, contractor));
    await expect(log).toContain(name(context, omar));
    await expect(log).not.toContain(name(context, copy.recommended));
    const entries = section.querySelectorAll(".sdp-timeline-entry");
    await expect(textOf(entries[entries.length - 1]!)).toContain(name(context, submitText));
    await expectNoChat(context);
  },
};

/**
 * Scenario RP-1067-3, the Consultant's Internal Communication: the amber banner, worded for the
 * Consultant; its own Recommended Codes, Internal Note and pick-up; never a shared move, never the
 * Contractor's entries; no composer.
 */
export const ConsultantInternal: Story = {
  render: (_args, context) => <TimelineDemo context={context} viewer={viewers.consultant} />,
  play: async (context) => {
    const panel = panelOf(context);
    await userEvent.click(within(panel).getByRole("tab", { name: new RegExp(name(context, copy.internal)) }));
    const tab = panel.querySelector<HTMLElement>(".sdp-internal")!;
    await expect(within(tab).getByRole("note")).toHaveTextContent(banner(viewers.consultant, storyLocale(context)));
    await expect([...tab.querySelectorAll('[data-chip="recommended-code"]')].map(textOf)).toEqual([
      `${name(context, copy.recommended)} B`,
      `${name(context, copy.recommended)} C`,
    ]);
    await expect(textOf(tab)).toContain("Fixings differ from E-204.");
    await expect(textOf(tab)).not.toContain(name(context, submitText));
    await expect(textOf(tab)).not.toContain(name(context, contractor));
    await expect(tab.querySelectorAll(".sdp-timeline-entry")).toHaveLength(4);
    await expectNoChat(context);
  },
};

/** The Contractor's Internal Communication: its own Return with the reason and its Internal Note; nothing of the Consultant's. */
export const ContractorInternal: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await userEvent.click(within(panel).getByRole("tab", { name: new RegExp(name(context, copy.internal)) }));
    const tab = panel.querySelector<HTMLElement>(".sdp-internal")!;
    await expect(within(tab).getByRole("note")).toHaveTextContent(banner(viewers.contractor, storyLocale(context)));
    await expect(textOf(tab)).toContain("Attach the 4000K datasheet.");
    await expect(textOf(tab)).toContain("Checked against the spec");
    await expect(textOf(tab)).not.toContain(name(context, consultant));
    await expect(tab.querySelector('[data-chip="recommended-code"]')).toBeNull();
    await expectNoChat(context);
  },
};
