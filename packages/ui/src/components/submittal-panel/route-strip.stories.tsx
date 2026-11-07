import type { Locale, WorkItemMapPosition, WorkItemWorkflowMap } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { submittalOwnerMap } from "../../storybook/submittal-route.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { submittalRoute } from "./route-model.ts";
import { SubmittalRouteStrip } from "./route-strip.tsx";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";
import { SubmittalWorkflowMap, type SubmittalWorkflowMapLabels } from "./workflow-map.tsx";

// Story data only (RP-1064): the API decides what the viewer may know; these stories show that the
// strip and the map draw no more than the `position` they are given.

const copy = {
  roles: {
    contractor: { en: "Contractor", ar: "المقاول" },
    consultant: { en: "Consultant", ar: "الاستشاري" },
    owner: { en: "Owner", ar: "المالك" },
    owner_representative: { en: "Owner Representative", ar: "ممثل المالك" },
  },
  states: { done: { en: "done", ar: "منجزة" }, current: { en: "current", ar: "الحالية" }, upcoming: { en: "upcoming", ar: "قادمة" } },
  with: { en: "With", ar: "لدى" },
  open: { en: "View workflow", ar: "عرض سير العمل" },
  route: { en: "Route", ar: "المسار" },
  outcome: { en: "Receives the outcome", ar: "يستلم النتيجة" },
  step: { en: "Step", ar: "الخطوة" },
  steps: { en: "Steps", ar: "خطوات" },
  title: { en: "Workflow", ar: "سير العمل" },
  version: { en: "Version", ar: "الإصدار" },
  youAreHere: { en: "You are here", ar: "أنت هنا" },
  happens: { en: "What happens here", ar: "ما يحدث هنا" },
  newOnly: { en: "Changes apply to new submittals only.", ar: "تنطبق التغييرات على التقديمات الجديدة فقط." },
  openSettings: { en: "Open in Workflow settings", ar: "فتح في إعدادات سير العمل" },
  close: { en: "Close", ar: "إغلاق" },
  pending: { en: "Pending Approval", ar: "بانتظار الاعتماد" },
  stepsTab: { en: "Steps", ar: "الخطوات" },
  mapTab: { en: "Map", ar: "الخريطة" },
  hereNow: { en: "Here now", ar: "هنا الآن" },
  people: { en: "Members on this Step", ar: "الأعضاء في هذه الخطوة" },
  privateSteps: { en: "Who works on these Steps, and which one has it, stays with them.", ar: "من يعمل على هذه الخطوات، وأيها لديه، يبقى لديهم." },
};

const labels = (locale: Locale): SubmittalWorkflowMapLabels => ({
  role: (role) => copy.roles[role][locale],
  withCompany: (company) => `${copy.with[locale]} ${company}`,
  open: copy.open[locale],
  route: copy.route[locale],
  state: (state) => copy.states[state][locale],
  outcome: copy.outcome[locale],
  steps: (count, formatted) => (count === 1 ? `1 ${copy.step[locale]}` : `${formatted} ${copy.steps[locale]}`),
  title: copy.title[locale],
  version: (name, version) => `${name} · ${copy.version[locale]} ${version}`,
  step: (n, role) => `${copy.step[locale]} ${n} · ${role}`,
  youAreHere: copy.youAreHere[locale],
  happens: copy.happens[locale],
  newOnly: copy.newOnly[locale],
  openSettings: copy.openSettings[locale],
  close: copy.close[locale],
  stepsTab: copy.stepsTab[locale],
  mapTab: copy.mapTab[locale],
  hereNow: copy.hereNow[locale],
  privateSteps: copy.privateSteps[locale],
  people: copy.people[locale],
});

/** The holder of the Contractor's own Step: a Member of the viewer's own Company (V14). Story data only. */
const holderName = "Hafiz Hamdan";

const bi = (en: string, ar: string) => ({ en, ar });
/** The item inside the Consultant, as the Contractor's map read gives it: the role and Company only (V14). */
const insideConsultant: WorkItemMapPosition = { kind: "company", role: "consultant", companyName: bi("Design Consultants LLC", "ديزاين للاستشارات") };
/** The Contractor's own Step: the positive control. */
const ownStep: WorkItemMapPosition = { kind: "own", stepKey: "internal_review" };
/** At an Owner review the Contractor isn't part of, the API names "Owner review" (ADR 0022). */
const ownerReview: WorkItemMapPosition = { kind: "company", role: "owner", companyName: bi("Owner review", "مراجعة المالك") };

type DemoArgs = { position: WorkItemMapPosition | null; settingsHref?: string; startOpen?: boolean; stepPeople?: WorkItemWorkflowMap["stepPeople"] };

function Demo({ context, position, settingsHref, startOpen = false, stepPeople }: DemoArgs & { context: StoryContext }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const [panelOpen, setPanelOpen] = useState(true);
  const [mapOpen, setMapOpen] = useState(startOpen);
  const map = { ...submittalOwnerMap(position), ...(stepPeople ? { stepPeople } : {}) };
  const route = submittalRoute({ definition: map.definition, stages: map.stages, position });
  if (!panelOpen) return <p className="p-4">—</p>;
  return (
    <SubmittalPanel
      locale={locale}
      labels={{ module: "Submittals", position: (n, total) => `${n} / ${total}`, previous: "Previous", next: "Next", close: copy.close[locale], hint: "Esc" }}
      crumb="TWR-TMC-CV-DAR-282"
      onClose={() => setPanelOpen(false)}
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
        <div className="px-5 pb-4">
          <SubmittalRouteStrip locale={locale} labels={labels(locale)} stops={route.stops} onOpen={() => setMapOpen(true)} />
          <SubmittalWorkflowMap
            open={mapOpen}
            onOpenChange={setMapOpen}
            locale={locale}
            labels={labels(locale)}
            map={map}
            settingsHref={settingsHref}
            // The page passes its own Member holding its own Step, and nobody else (V14).
            {...(position?.kind === "own" ? { holder: holderName } : {})}
          />
        </div>
      }
    />
  );
}

const meta = {
  title: "Views/Submittal Panel/Route strip",
  args: { position: insideConsultant },
  render: (args, context) => <Demo context={context} {...args} />,
} satisfies Meta<DemoArgs>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const stripOf = (context: PlayContext) => within(context.canvasElement).getByRole("button", { name: new RegExp(storyText(context, copy.open)) });
const mapOf = () => within(document.body).getByRole("dialog", { name: /^(Workflow|سير العمل)$/ });
const currentStops = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("li[data-state='current']")];
const noTimesOrCounts = async (root: HTMLElement) => {
  // No due date, no "Time allowed", no count of items, and never "template" or "v3" (gaps A1, A10, A11).
  for (const banned of [/time allowed/i, /due/i, /used by/i, /template/i, /\bv\d/i, /client/i, /المدة المسموحة/, /قالب/, /العميل/]) {
    await expect({ banned: String(banned), found: banned.test(root.textContent ?? "") }).toEqual({ banned: String(banned), found: false });
  }
};

/**
 * Scenario RP-1064-1. As the Contractor, while the item is inside the Consultant (V14): the strip
 * marks the Consultant's stop as a whole, "With Design Consultants LLC"; the map lists the
 * Consultant's Steps (V20) and outlines none of them, only the Consultant's block. No due date,
 * time or count anywhere.
 */
export const InsideTheConsultant: Story = {
  play: async (context) => {
    const strip = stripOf(context);
    // Named by what it does; the route, with each stop's state, is its description.
    await expect(strip).toHaveAccessibleDescription(new RegExp(storyText(context, bi("Consultant With Design Consultants LLC \\(current\\)", "الاستشاري لدى ديزاين للاستشارات \\(الحالية\\)"))));
    const current = currentStops(strip);
    await expect(current).toHaveLength(1);
    await expect(current[0]).toHaveTextContent(storyText(context, copy.roles.consultant));
    await expect(current[0]).toHaveTextContent(storyText(context, bi("With Design Consultants LLC", "لدى ديزاين للاستشارات")));
    await noTimesOrCounts(strip);

    await userEvent.click(strip);
    const map = await waitFor(mapOf);
    // Every Company's Steps are listed (V20)…
    await expect(map.querySelector("[data-step='consultant_engineer']")).not.toBeNull();
    await expect(map.querySelector("[data-step='consultant_manager']")).not.toBeNull();
    // …but none of the Consultant's is the one holding it (V14): only its whole block is marked.
    await expect(map.querySelectorAll("[data-step][aria-current]")).toHaveLength(0);
    const block = map.querySelector<HTMLElement>("[data-stop][aria-current]")!;
    await expect(block.querySelectorAll("[data-step]")).toHaveLength(2);
    // "Here now" belongs on the viewer's own Step; another Company's block says who holds it.
    await expect(block).toHaveTextContent(storyText(context, bi("With Design Consultants LLC", "لدى ديزاين للاستشارات")));
    await expect(block).not.toHaveTextContent(storyText(context, copy.hereNow));
    // Its Steps by name, and nobody working on them (RP-1188, gap table row 58).
    await expect(block).toHaveTextContent(storyText(context, copy.privateSteps));
    await expect(block).not.toHaveTextContent(holderName);
    await expect(map).not.toHaveTextContent(holderName);
    await noTimesOrCounts(map);
    // The Map tab: the large strip and the cards per Step, the Consultant's block marked, none of its Steps.
    await userEvent.click(within(map).getByRole("tab", { name: storyText(context, copy.mapTab) }));
    await waitFor(() => expect(map.querySelector("[data-map-step='consultant_engineer']")).not.toBeNull());
    await expect(map.querySelector("[data-step]")).toBeNull();
    await noTimesOrCounts(map);
    // Only a Member who may edit Workflows sees the way to its settings.
    await expect(within(map).queryByRole("link", { name: storyText(context, copy.openSettings) })).toBeNull();
  },
};

/**
 * Scenario RP-1064-1's positive control: the Contractor's own Step is the one outlined, "Here now", with its
 * own Member holding it; the Steps before it done, the Consultant's and Owner's blocks to come (RP-1188, row 57).
 */
export const OwnStep: Story = {
  args: { position: ownStep, startOpen: true },
  parameters: overlay,
  play: async (context) => {
    const map = await waitFor(mapOf);
    const here = [...map.querySelectorAll<HTMLElement>("[data-step][aria-current='step']")];
    await expect(here.map((el) => el.dataset.step)).toEqual(["internal_review"]);
    await expect(here[0]).toHaveTextContent(storyText(context, copy.hereNow));
    await expect(here[0]).toHaveTextContent(holderName);
    await expect(currentStops(map)[0]).toHaveTextContent(storyText(context, copy.roles.contractor));
    // Only the Step holding it names who holds it.
    await expect(map.querySelectorAll("[data-step]:not([aria-current])").length).toBeGreaterThan(0);
    for (const other of map.querySelectorAll<HTMLElement>("[data-step]:not([aria-current])")) await expect(other).not.toHaveTextContent(holderName);
    // In the Map tab, the same Step is "You are here".
    await userEvent.click(within(map).getByRole("tab", { name: storyText(context, copy.mapTab) }));
    await waitFor(() => expect(map.querySelector("[data-map-step='internal_review']")).toHaveTextContent(storyText(context, copy.youAreHere)));
  },
};

/**
 * Scenario RP-1189-1 (gap table v3 row 21): each of the viewer's own Step cards lists the Members on it, its
 * Step Pool as the API gives it. Another Company's block lists none, even if a name were given for one of
 * its Steps (V14, V15): the API gives none, and the modal draws people on own cards only.
 */
export const MembersOnOwnSteps: Story = {
  args: {
    position: ownStep,
    startOpen: true,
    stepPeople: [
      ...submittalOwnerMap(ownStep).stepPeople,
      // Never given by the API (V14); here only to show the modal draws no one on another Company's block.
      { stepKey: "consultant_engineer", names: [bi("Nadia Saleh", "نادية صالح")] },
    ],
  },
  parameters: overlay,
  play: async (context) => {
    const map = await waitFor(mapOf);
    const card = (key: string) => map.querySelector<HTMLElement>(`[data-step='${key}']`)!;
    const people = (key: string) => within(card(key)).queryByRole("list", { name: storyText(context, copy.people) });
    await expect(people("internal_review")).toHaveTextContent(storyText(context, bi("Faisal Al-Harbi", "فيصل الحربي")));
    await expect(people("draft")).toHaveTextContent(storyText(context, bi("Ali Sonour", "علي سنور")));
    await expect(people("draft")).toHaveTextContent(storyText(context, bi("Khalid Bakr", "خالد بكر")));
    // The Consultant's and the Owner's blocks: their Steps by name, nobody on them.
    for (const block of map.querySelectorAll<HTMLElement>("li[data-stop]")) {
      await expect(within(block).queryByRole("list", { name: storyText(context, copy.people) })).toBeNull();
      await expect(block).not.toHaveTextContent(storyText(context, bi("Nadia Saleh", "نادية صالح")));
    }
    await noTimesOrCounts(map);
  },
};

/** At an Owner review the Contractor isn't part of, it reads "With Owner review" (ADR 0022). */
export const WithOwnerReview: Story = {
  args: { position: ownerReview },
  play: async (context) => {
    const current = currentStops(stripOf(context));
    await expect(current[0]).toHaveTextContent(storyText(context, copy.roles.owner));
    await expect(current[0]).toHaveTextContent(storyText(context, bi("With Owner review", "لدى مراجعة المالك")));
  },
};

/** Closed (here Approved): nobody holds it, so every stop is done, the raiser's closing one too (the design's `wf()`). */
export const Closed: Story = {
  args: { position: { kind: "closed", stepKey: "approved" } },
  play: async (context) => {
    const stops = [...stripOf(context).querySelectorAll<HTMLElement>("li[data-state]")];
    await expect(stops.map((s) => s.dataset.state)).toEqual(["done", "done", "done", "done"]);
    await expect(currentStops(stripOf(context))).toHaveLength(0);
  },
};

/** A Project Admin, who may edit Workflows, also gets "Open in Workflow settings". */
export const ForAProjectAdmin: Story = {
  args: { position: insideConsultant, settingsHref: "#settings/workflows", startOpen: true },
  parameters: overlay,
  play: async (context) => {
    const map = await waitFor(mapOf);
    await expect(within(map).getByRole("link", { name: storyText(context, copy.openSettings) })).toHaveAttribute("href", "#settings/workflows");
  },
};

/** Esc closes the innermost layer first: the map, then the panel (README §1). */
export const EscClosesTheMapFirst: Story = {
  play: async (context) => {
    await userEvent.click(stripOf(context));
    await waitFor(mapOf);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: /^(Workflow|سير العمل)$/ })).toBeNull());
    // The panel is still open, and focus is back on the strip.
    await waitFor(() => expect(stripOf(context)).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(context.canvasElement).queryByRole("button", { name: new RegExp(storyText(context, copy.open)) })).toBeNull());
  },
};
