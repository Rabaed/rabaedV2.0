import { directionOf, type BilingualText, type Locale, type WorkItemMapPosition } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { submittalOwnerMap } from "../../storybook/submittal-route.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { SubmittalPanelRail, SubmittalPanelWorkflowAndLog } from "./panel-rail.tsx";
import { SubmittalPanelSizeSwitch, useSubmittalPanelSize, type SubmittalPanelSizeLabels } from "./panel-resize.tsx";
import { SubmittalPanelSections } from "./panel-sections.tsx";
import { submittalRoute } from "./route-model.ts";
import { SubmittalRouteSteps, SubmittalRouteStrip, type SubmittalRouteLabels } from "./route-strip.tsx";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

/*
 * The side rail's Workflow block (RP-1093, README §4.9): in Wide and Full, the route strip, then the
 * vertical Step list, with the "Workflow map ↗" link; below 880px the same content is in the in-flow
 * "Workflow & approval log" section. The strip also stays under the identity at every band (README
 * §4.4), as the design's prototype draws it. Story data only: each row says no more than the
 * `position` the map read gives (V14).
 */

const bi = (en: string, ar: string): BilingualText => ({ en, ar });

const copy = {
  roles: {
    contractor: bi("Contractor", "المقاول"),
    consultant: bi("Consultant", "الاستشاري"),
    owner: bi("Owner", "المالك"),
    owner_representative: bi("Owner Representative", "ممثل المالك"),
  },
  states: { done: bi("done", "منجزة"), current: bi("current", "الحالية"), upcoming: bi("upcoming", "قادمة") },
  with: bi("With", "لدى"),
  open: bi("View workflow", "عرض سير العمل"),
  route: bi("Route", "المسار"),
  outcome: bi("Receives the outcome", "يستلم النتيجة"),
  step: bi("Step", "الخطوة"),
  steps: bi("Steps", "خطوات"),
  pending: bi("Pending Approval", "بانتظار الاعتماد"),
  close: bi("Close", "إغلاق"),
  section: bi("Workflow & approval log", "سير العمل وسجل الاعتماد"),
  workflow: bi("Workflow", "سير العمل"),
  map: bi("Workflow map", "خريطة سير العمل"),
  log: bi("Approval log", "سجل الاعتماد"),
  logBody: bi("The approval log", "سجل الاعتماد"),
  group: bi("Size", "الحجم"),
  compact: bi("Compact", "مضغوط"),
  normal: bi("Normal", "عادي"),
  wide: bi("Wide", "عريض"),
  full: bi("Full", "كامل"),
  grip: bi("Drag to resize · double-click to switch Normal and Wide", "اسحب لتغيير الحجم · انقر مرتين للتبديل بين عادي وعريض"),
  collapseAll: bi("Collapse all", "طي الكل"),
  expandAll: bi("Expand all", "فتح الكل"),
};

const labels = (locale: Locale): SubmittalRouteLabels => ({
  role: (role) => copy.roles[role][locale],
  withCompany: (company) => `${copy.with[locale]} ${company}`,
  open: copy.open[locale],
  route: copy.route[locale],
  state: (state) => copy.states[state][locale],
  outcome: copy.outcome[locale],
  steps: (count, formatted) => (count === 1 ? `1 ${copy.step[locale]}` : `${formatted} ${copy.steps[locale]}`),
});

const sizeLabels = (locale: Locale): SubmittalPanelSizeLabels => ({
  group: copy.group[locale],
  sizes: { compact: copy.compact[locale], normal: copy.normal[locale], wide: copy.wide[locale], full: copy.full[locale] },
  grip: copy.grip[locale],
});

const designConsultants = bi("Design Consultants LLC", "ديزاين للاستشارات");
/** The Contractor's own Step: the positive control. */
const ownStep: WorkItemMapPosition = { kind: "own", stepKey: "internal_review" };
/** The item inside the Consultant, as the Contractor's map read gives it: the role and Company only (V14). */
const insideConsultant: WorkItemMapPosition = { kind: "company", role: "consultant", companyName: designConsultants };

type DemoArgs = { position: WorkItemMapPosition; initial?: number };

function Demo({ context, position, initial = 960 }: DemoArgs & { context: StoryContext }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const size = useSubmittalPanelSize({ initial, dir: directionOf(locale) });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState(0);
  const map = submittalOwnerMap(position);
  const route = submittalRoute({ definition: map.definition, stages: map.stages, position });
  const openMap = () => setOpened((n) => n + 1);
  const railLabels = { workflow: copy.workflow[locale], map: copy.map[locale], log: copy.log[locale] };
  const workflow = (
    <div className="flex flex-col gap-4">
      <SubmittalRouteStrip locale={locale} labels={labels(locale)} stops={route.stops} onOpen={openMap} />
      <SubmittalRouteSteps locale={locale} labels={labels(locale)} route={route} />
    </div>
  );
  const log = <p className="text-[12.5px] text-muted">{copy.logBody[locale]}</p>;
  return (
    <>
      {/* How often the Workflow map was asked for. */}
      <output data-opened={opened} />
      <SubmittalPanel
        locale={locale}
        labels={{ module: "Submittals", position: (n, total) => `${n} / ${total}`, previous: "Previous", next: "Next", close: copy.close[locale], hint: "Esc" }}
        crumb={<bdi dir="ltr">TWR-TMC-CV-DAR-282</bdi>}
        onClose={() => {}}
        width={size.width}
        resizing={size.resizing}
        topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels(locale)} />}
        labelledBy={ids.labelledBy}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={{ number: "TWR-TMC-CV-DAR-282", revisionNo: null }}
            noNumber="—"
            subject={locale === "ar" ? "نظام الصرف" : "Drainage System"}
            numberId={ids.numberId}
            subjectId={ids.subjectId}
            chips={<StagePill stage="pending" label={copy.pending[locale]} />}
          />
        }
        route={
          <div className="sdp-route-slot px-5 pb-4">
            <SubmittalRouteStrip locale={locale} labels={labels(locale)} stops={route.stops} onOpen={openMap} />
          </div>
        }
        tabs={
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
                summary: "",
                children: <SubmittalPanelWorkflowAndLog labels={railLabels} workflow={workflow} onOpenMap={openMap} log={log} />,
                inflowOnly: true,
              },
            ]}
          />
        }
        rail={<SubmittalPanelRail labels={railLabels} workflow={workflow} onOpenMap={openMap} log={log} />}
      />
    </>
  );
}

const meta = {
  title: "Views/Submittal Panel/Rail workflow",
  parameters: overlay,
  args: { position: ownStep },
  render: (args, context) => <Demo context={context} {...args} />,
} satisfies Meta<DemoArgs>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const shown = (el: Element | null) => el !== null && getComputedStyle(el).display !== "none";
const railOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>(".sdp-rail")!;
const inflowOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>('[data-section="workflow"]')!;
const openedOf = (context: PlayContext) => context.canvasElement.querySelector<HTMLElement>("[data-opened]")!.dataset.opened;
const rowsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-route-steps] > li")];

/** The Workflow block in `el`: the route strip first, then the Step list, one row a stop, the current one marked. */
async function expectWorkflow(context: PlayContext, el: HTMLElement, current: number, lines: string[]) {
  const t = (text: BilingualText) => storyText(context, text);
  const strip = within(el).getByRole("button", { name: t(copy.open) });
  const steps = el.querySelector<HTMLElement>("[data-route-steps]")!;
  await expect(strip).toBeVisible();
  await expect(steps).toBeVisible();
  // The strip sits above the list.
  await expect(strip.getBoundingClientRect().bottom).toBeLessThanOrEqual(steps.getBoundingClientRect().top);
  const rows = rowsOf(el);
  await expect(rows.map((r) => r.querySelector("small")?.textContent)).toEqual(lines);
  await expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual(rows.map((_, i) => (i === current ? "step" : null)));
  await expect(rows.map((r) => r.dataset.state)).toEqual(rows.map((_, i) => (i < current ? "done" : i === current ? "current" : "upcoming")));
  await expect(rows.map((r) => r.querySelector(".sdp-role") !== null)).toEqual([true, true, true, true]);
}

const ownLines = (context: PlayContext) => {
  const ar = storyLocale(context) === "ar";
  return [ar ? "مدير مشروع المقاول" : "Contractor PM", ar ? "2 خطوات" : "2 Steps", ar ? "1 الخطوة" : "1 Step", storyText(context, copy.outcome)];
};

/**
 * The rail's route strip is one line (README §4.9): every stop and chevron on the first line, nothing
 * cut off sideways. The stop holding the item keeps its role and line; the others are their role's tile.
 */
async function expectStripOnOneLine(context: PlayContext) {
  const strip = railOf(context).querySelector<HTMLElement>(".sdp-route")!;
  const stops = [...strip.querySelectorAll<HTMLElement>("li")];
  // On one line, the stops (centred on it) share their middle, whatever their height.
  const middles = stops.map((li) => {
    const box = li.getBoundingClientRect();
    return Math.round(box.top + box.height / 2);
  });
  await expect(middles.every((middle) => Math.abs(middle - middles[0]!) <= 1)).toBe(true);
  await expect(strip.querySelector("ol")!.scrollWidth).toBeLessThanOrEqual(strip.querySelector("ol")!.clientWidth);
  await expect(stops.at(-1)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(strip.getBoundingClientRect().bottom);
  // Every stop's role is still in the strip's description for assistive technology.
  const button = within(railOf(context)).getByRole("button", { name: storyText(context, copy.open) });
  for (const role of [copy.roles.contractor, copy.roles.consultant, copy.roles.owner]) await expect(button).toHaveAccessibleDescription(new RegExp(storyText(context, role)));
}

/** Nothing scrolls sideways, in the panel or the rail. */
async function expectNoSidewaysScroll(context: PlayContext) {
  const body = panelOf(context).querySelector(".sdp-body")!;
  await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
  const rail = railOf(context);
  await expect(rail.scrollWidth).toBeLessThanOrEqual(rail.clientWidth);
}

/**
 * Wide (960px): the rail's Workflow block shows the route strip, then the vertical Step list (one row a
 * stop: the viewer's own Step named where its Participant holds the item), and "Workflow map ↗",
 * which opens the map. The strip also stays under the identity (README §4.4); the in-flow section is hidden.
 * Full is the same block in the 360px rail; the story harness is 1024px wide, below the Full band.
 */
export const Wide: Story = {
  play: async (context) => {
    const rail = railOf(context);
    await expect(shown(rail)).toBe(true);
    await expect(shown(inflowOf(context))).toBe(false);
    await expectWorkflow(context, rail.querySelector<HTMLElement>('[data-rail="workflow"]')!, 0, ownLines(context));
    await expect(panelOf(context).querySelector(".sdp-route-slot .sdp-route")).toBeVisible();
    await expectStripOnOneLine(context);
    await userEvent.click(within(rail).getByRole("button", { name: storyText(context, copy.map) }));
    await expect(openedOf(context)).toBe("1");
    await userEvent.click(within(rail).getByRole("button", { name: storyText(context, copy.open) }));
    await expect(openedOf(context)).toBe("2");
    await expectNoSidewaysScroll(context);
    // Live with the bands: at Normal the same content is in the in-flow section, and the rail is gone.
    await userEvent.click(within(panelOf(context)).getByRole("button", { name: storyText(context, copy.normal) }));
    await waitFor(() => expect(shown(inflowOf(context))).toBe(true));
    await expect(shown(rail)).toBe(false);
    await expectWorkflow(context, inflowOf(context), 0, ownLines(context));
  },
};

/**
 * Normal (640px): the in-flow "Workflow & approval log" section holds the strip, the Step list and the
 * map link; the rail is hidden. Wider, the rail takes them back.
 */
export const BelowWide: Story = {
  args: { initial: 640 },
  play: async (context) => {
    const section = inflowOf(context);
    await expect(shown(section)).toBe(true);
    await expect(shown(railOf(context))).toBe(false);
    await expectWorkflow(context, section, 0, ownLines(context));
    await userEvent.click(within(section).getByRole("button", { name: storyText(context, copy.map) }));
    await expect(openedOf(context)).toBe("1");
    await userEvent.click(within(panelOf(context)).getByRole("button", { name: storyText(context, copy.wide) }));
    await waitFor(() => expect(shown(railOf(context))).toBe(true));
    await expect(shown(section)).toBe(false);
  },
};

/**
 * As the Contractor while the Consultant holds the item (V14): the Consultant's row names only the
 * Company the API gives, never one of its Steps; no row names a Step (`Wide` is the positive control).
 */
export const InsideAnotherCompany: Story = {
  args: { position: insideConsultant },
  play: async (context) => {
    const block = railOf(context).querySelector<HTMLElement>('[data-rail="workflow"]')!;
    const ar = storyLocale(context) === "ar";
    await expectWorkflow(context, block, 1, [
      ar ? "3 خطوات" : "3 Steps",
      `${storyText(context, copy.with)} ${storyText(context, designConsultants)}`,
      ar ? "1 الخطوة" : "1 Step",
      storyText(context, copy.outcome),
    ]);
    await expect(block.textContent).not.toMatch(/Consultant Engineer|Consultant Manager|مهندس الاستشاري|مدير الاستشاري/);
    // The longest line, "With Design Consultants LLC", still keeps the strip on one line.
    await expectStripOnOneLine(context);
  },
};

/**
 * A closed item (here Approved, Code B): nobody holds it, so every row is done ✓ and none current,
 * the raiser's closing stop too, in the Step list and the strip alike (the design's `wf()`).
 */
export const Closed: Story = {
  args: { position: { kind: "closed", stepKey: "approved" } },
  play: async (context) => {
    const block = railOf(context).querySelector<HTMLElement>('[data-rail="workflow"]')!;
    const ar = storyLocale(context) === "ar";
    await expectWorkflow(context, block, 4, [ar ? "3 خطوات" : "3 Steps", ar ? "2 خطوات" : "2 Steps", ar ? "1 الخطوة" : "1 Step", storyText(context, copy.outcome)]);
    await expect(block.querySelectorAll("[data-route-steps] .bg-brand")).toHaveLength(0);
    await expect([...block.querySelectorAll<HTMLElement>(".sdp-route li[data-state]")].map((s) => s.dataset.state)).toEqual(["done", "done", "done", "done"]);
    await expectStripOnOneLine(context);
  },
};
