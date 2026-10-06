import { dashboardCard, formatNumber, workItemSearchParams, type ChainBucket, type CodeCState, type Dashboard } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { ProjectDashboard } from "./project-dashboard.tsx";

// The Dashboard's Type cards (RP-351, spec RP-344): one card per Work Item Type
// under its Module, a card's bars by its Type's outcome kind, every number a
// link to the List; a Review Code card's Code C line (RP-352). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  snagList: b("Snag List", "قائمة الملاحظات"),
  submittals: b("Submittals", "الاعتمادات"),
  inspections: b("Inspections", "الفحوصات"),
  siteReports: b("Site Reports", "التقارير الموقعية"),
  inPreparation: b("In preparation", "قيد الإعداد"),
  pending: b("Pending", "قيد الانتظار"),
  // 10 of the 19 chains the raiser's Company sees, its 3 In preparation among them.
  approvedAB: b("Approved (A+B) 10 · ", "المعتمد (A+B) 10 · "),
  mar: b("Material Submittal", "اعتماد مواد"),
  wir: b("Work Inspection", "فحص الأعمال"),
  dsr: b("Daily Site Report", "تقرير الموقع اليومي"),
  cmt: b("Comments", "الملاحظات"),
  open: b("Open", "مفتوحة"),
  codeC: b("Code C", "الرمز C"),
  approvedOnRevision: b("approved on revision", "معتمد بعد التعديل"),
  awaitingRevision: b("awaiting revision", "بانتظار التعديل"),
  noRevisionYet: b("no Revision yet", "لا تعديل بعد"),
  revisionInProgress: b("Revision in progress", "التعديل جارٍ"),
  rejectedAfterC: b("rejected after C", "مرفوض بعد C"),
};

const counts = (entries: [ChainBucket, number][]) => new Map<ChainBucket | null, number>(entries);
const codeCCounts = (entries: [CodeCState, number][]) => new Map<CodeCState | null, number>(entries);

/** The MAR card: 5 chains that had a Code C, 3 since approved; the raiser's Company sees the 2 awaiting split. */
const marCard = (viewer: "raiser" | "other") =>
  dashboardCard({
    type: { code: "MAR", name: copy.mar },
    moduleKey: "submittals",
    outcomeKind: "review_code",
    counts: counts([["pending", 4], ...(viewer === "raiser" ? [["in_preparation", 3] as [ChainBucket, number]] : []), ["C", 2], ["A", 6], ["B", 4], ["D", 0]]),
    codeCCounts: codeCCounts(
      viewer === "raiser"
        ? [["approvedOnRevision", 3], ["noRevisionYet", 1], ["revisionInProgress", 1]]
        : [["approvedOnRevision", 3], ["awaitingRevision", 2]],
    ),
  });

/** As a Contractor sees it: its own MARs In preparation too. */
const contractor: Dashboard = {
  modules: [
    {
      key: "snag_list",
      cards: [
        dashboardCard({
          type: { code: "CMT", name: copy.cmt },
          moduleKey: "snag_list",
          outcomeKind: "none",
          counts: counts([["pending", 6], ["approved", 11], ["cancelled", 1]]),
        }),
      ],
    },
    {
      key: "submittals",
      cards: [marCard("raiser")],
    },
    {
      key: "inspections",
      cards: [
        dashboardCard({
          type: { code: "WIR", name: copy.wir },
          moduleKey: "inspections",
          outcomeKind: "inspection_result",
          counts: counts([["pending", 2], ["passed", 7], ["passed_with_comments", 2], ["failed", 1]]),
        }),
      ],
    },
    {
      key: "site_reports",
      cards: [
        dashboardCard({
          type: { code: "DSR", name: copy.dsr },
          moduleKey: "site_reports",
          outcomeKind: "none",
          counts: counts([["pending", 1], ["approved", 20], ["rejected", 1]]),
        }),
      ],
    },
  ],
};

/** As the Consultant sees the same Project: no In preparation figure, and awaiting revision as one figure (V1). */
const consultant: Dashboard = {
  modules: contractor.modules.map((m) => ({
    ...m,
    cards: m.cards.map((c) =>
      c.type.code === "MAR"
        ? marCard("other")
        : c.kind === "outcomes"
          ? { ...c, inPreparation: null, total: { ...c.total, count: c.total.count - (c.inPreparation?.count ?? 0) } }
          : c,
    ),
  })),
};

/** A Code C chain since rejected: the line adds "rejected after C". */
const withRejectedAfterC: Dashboard = {
  modules: [
    {
      key: "submittals",
      cards: [
        dashboardCard({
          type: { code: "MAR", name: copy.mar },
          moduleKey: "submittals",
          outcomeKind: "review_code",
          counts: counts([["A", 3], ["C", 1], ["D", 1]]),
          codeCCounts: codeCCounts([["approvedOnRevision", 3], ["awaitingRevision", 1], ["rejectedAfterC", 1]]),
        }),
      ],
    },
  ],
};

const hrefFor = (query: Parameters<typeof workItemSearchParams>[0]) => `?${workItemSearchParams(query)}`;

const meta = {
  title: "Views/ProjectDashboard",
  component: ProjectDashboard,
  args: { dashboard: contractor, locale: "en", hrefFor },
  render: (args, context) => <ProjectDashboard {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof ProjectDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const cardOf = (context: PlayContext, name: { en: string; ar: string }) =>
  context.canvas.getByRole("article", { name: new RegExp(storyText(context, name)) });

/**
 * The raiser's Company: every card kind, under its Module, the Snag List first;
 * In preparation on its own MAR card; every number links to its List.
 */
export const WithInPreparation: Story = {
  play: async (context) => {
    const headings = context.canvas.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    await expect(headings).toEqual([copy.snagList, copy.submittals, copy.inspections, copy.siteReports].map((t) => storyText(context, t)));
    const mar = within(cardOf(context, copy.mar));
    await expect(mar.getByRole("link", { name: new RegExp(storyText(context, copy.inPreparation)) })).toHaveAttribute(
      "href",
      "?type=MAR&bucket=in_preparation",
    );
    await expect(mar.getByRole("link", { name: new RegExp(`^${storyText(context, copy.pending)}`) })).toHaveAttribute("href", "?type=MAR&bucket=pending");
    const approved = `${storyText(context, copy.approvedAB)}${formatNumber(0.63, storyLocale(context), { style: "percent" })}`;
    await expect(mar.getByRole("link", { name: approved })).toHaveAttribute("href", "?type=MAR&bucket=A%2CB");
    await expect(mar.getAllByRole("listitem")).toHaveLength(5);
    await expect(within(cardOf(context, copy.wir)).getAllByRole("listitem")).toHaveLength(4);
    await expect(within(cardOf(context, copy.dsr)).getAllByRole("listitem")).toHaveLength(3);
    const snag = within(cardOf(context, copy.cmt));
    await expect(snag.getByRole("link", { name: new RegExp(storyText(context, copy.open)) })).toHaveAttribute(
      "href",
      "?module=snag_list&type=CMT&bucket=pending%2Cin_preparation",
    );
  },
};

/** Another Company: the same cards, with no In preparation figure and awaiting revision as one figure. */
export const WithoutInPreparation: Story = {
  args: { dashboard: consultant },
  play: async (context) => {
    await expect(context.canvas.queryByText(new RegExp(storyText(context, copy.inPreparation)))).toBeNull();
    const mar = within(cardOf(context, copy.mar));
    await expect(mar.getByRole("link", { name: new RegExp(`^${storyText(context, copy.pending)}`) })).toBeVisible();
    // The same Approved % as the raiser's Company: In preparation is not in it.
    const approved = `${storyText(context, copy.approvedAB)}${formatNumber(0.63, storyLocale(context), { style: "percent" })}`;
    await expect(mar.getByRole("link", { name: approved })).toBeVisible();
    await expect(mar.getByRole("link", { name: `${storyText(context, copy.awaitingRevision)} 2` })).toHaveAttribute("href", "?type=MAR&codeC=awaitingRevision");
    await expect(mar.queryByText(new RegExp(storyText(context, copy.noRevisionYet)))).toBeNull();
    await expect(mar.queryByText(new RegExp(storyText(context, copy.revisionInProgress)))).toBeNull();
  },
};

/**
 * The raiser's Company's Code C line: "Code C 5 · approved on revision 3 (60%)
 * · awaiting revision 2", awaiting revision split into "no Revision yet" and
 * "Revision in progress"; every figure links to its List.
 */
export const CodeCLine: Story = {
  play: async (context) => {
    const line = within(context.canvas.getByTestId("code-c-MAR"));
    const t = (text: { en: string; ar: string }) => storyText(context, text);
    await expect(line.getByRole("link", { name: `${t(copy.codeC)} 5` })).toHaveAttribute(
      "href",
      "?type=MAR&codeC=approvedOnRevision%2CawaitingRevision%2CrejectedAfterC",
    );
    const percent = formatNumber(0.6, storyLocale(context), { style: "percent" });
    await expect(line.getByRole("link", { name: `${t(copy.approvedOnRevision)} 3 (${percent})` })).toHaveAttribute("href", "?type=MAR&codeC=approvedOnRevision");
    await expect(line.getByRole("link", { name: `${t(copy.awaitingRevision)} 2` })).toHaveAttribute("href", "?type=MAR&codeC=awaitingRevision");
    await expect(line.getByRole("link", { name: `${t(copy.noRevisionYet)} 1` })).toHaveAttribute("href", "?type=MAR&codeC=noRevisionYet");
    await expect(line.getByRole("link", { name: `${t(copy.revisionInProgress)} 1` })).toHaveAttribute("href", "?type=MAR&codeC=revisionInProgress");
    await expect(line.queryByText(new RegExp(t(copy.rejectedAfterC)))).toBeNull();
    // Only Review Code cards have the line.
    await expect(within(cardOf(context, copy.wir)).queryByText(new RegExp(t(copy.codeC)))).toBeNull();
  },
};

/** The Code C line adds "rejected after C" when there is any. */
export const CodeCLineRejectedAfterC: Story = {
  args: { dashboard: withRejectedAfterC },
  play: async (context) => {
    const line = within(context.canvas.getByTestId("code-c-MAR"));
    await expect(line.getByRole("link", { name: `${storyText(context, copy.rejectedAfterC)} 1` })).toHaveAttribute("href", "?type=MAR&codeC=rejectedAfterC");
  },
};

/** Narrow: the cards stack, one per row, and nothing scrolls sideways. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    await expect(context.canvasElement.scrollWidth).toBeLessThanOrEqual(context.canvasElement.clientWidth);
  },
};

/** A Project with no Work Item Types yet. */
export const NoTypes: Story = {
  args: { dashboard: { modules: [] } },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, b("No Work Item Types on this Project yet.", "لا توجد أنواع عناصر عمل في هذا المشروع بعد.")))).toBeVisible();
  },
};
