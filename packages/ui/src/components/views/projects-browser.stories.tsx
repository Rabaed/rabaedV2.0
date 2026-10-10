import type { ProjectSummary } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { projectsBrowserLabels } from "../../storybook/views.ts";
import { Button } from "../button/button.tsx";
import { ProjectsBrowser } from "./projects-browser.tsx";

// The Projects page's body: search, the All / Active / Closed chips and the
// card grid. Story data only.
const b = (en: string, ar: string) => ({ en, ar });

const project = (n: number, rest: Partial<ProjectSummary>): ProjectSummary => ({
  id: `00000000-0000-4000-8000-00000000020${n}`,
  projectNumber: n,
  code: "TWR",
  name: b("Riyadh Gate Tower", "برج بوابة الرياض"),
  status: "active",
  hostCompany: { legalName: b("Tamkeen Contracting", "تمكين للمقاولات") },
  projectRole: { baseRole: "contractor", name: b("Contractor", "المقاول") },
  isProjectAdmin: false,
  needMyAction: 0,
  modules: ["submittals"],
  ...rest,
});

const projects: ProjectSummary[] = [
  project(1, { needMyAction: 12, isProjectAdmin: true }),
  project(2, { code: "KAFD2", name: b("KAFD Parcel 2.10 Offices", "مكاتب كافد قطعة 2.10"), needMyAction: 3 }),
  project(3, { code: "JED7", name: b("Jeddah Waterfront Villas, Phase 7", "فلل واجهة جدة البحرية، المرحلة 7") }),
  project(4, { code: "DMM", name: b("Dammam Logistics Hub", "مركز الدمام اللوجستي"), status: "closed" }),
];

const meta = {
  title: "Views/ProjectsBrowser",
  component: ProjectsBrowser,
  args: {
    projects,
    locale: "en",
    labels: projectsBrowserLabels.en,
    href: (id: string) => `#/projects/${id}`,
    submittals: Object.fromEntries(projects.map((p, i) => [p.id, [48, 31, 0, 204][i]!])),
  },
  render: (args, context) => (
    <ProjectsBrowser {...args} locale={storyLocale(context)} labels={projectsBrowserLabels[storyLocale(context)]} />
  ),
} satisfies Meta<typeof ProjectsBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All Projects as cards; the Closed chip keeps only the closed one; a search by code narrows to one. */
export const Filtering: Story = {
  play: async ({ canvas, globals }) => {
    const labels = projectsBrowserLabels[globals.locale === "ar" ? "ar" : "en"];
    await expect(within(canvas.getByRole("list", { name: labels.list })).getAllByRole("listitem")).toHaveLength(4);
    await userEvent.click(canvas.getByRole("button", { name: labels.filterClosed }));
    await expect(canvas.getByRole("button", { name: labels.filterClosed })).toHaveAttribute("aria-pressed", "true");
    await expect(within(canvas.getByRole("list", { name: labels.list })).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: labels.all }));
    await userEvent.type(canvas.getByRole("searchbox", { name: labels.search }), "kafd");
    await expect(within(canvas.getByRole("list", { name: labels.list })).getAllByRole("listitem")).toHaveLength(1);
  },
};

/** Closed Projects come last, whatever order the API gave them in. */
export const ClosedLast: Story = {
  args: { projects: [projects[3]!, projects[0]!, projects[1]!] },
  play: async ({ canvas, globals }) => {
    const labels = projectsBrowserLabels[globals.locale === "ar" ? "ar" : "en"];
    const items = within(canvas.getByRole("list", { name: labels.list })).getAllByRole("listitem");
    await expect(items).toHaveLength(3);
    await expect(within(items[2]!).getByText(labels.closed)).toBeVisible();
    await expect(within(items[0]!).queryByText(labels.closed)).toBeNull();
  },
};

/** A search with no match says so, and the chips stay. */
export const NoMatches: Story = {
  play: async ({ canvas, globals }) => {
    const labels = projectsBrowserLabels[globals.locale === "ar" ? "ar" : "en"];
    await userEvent.type(canvas.getByRole("searchbox", { name: labels.search }), "zzzz");
    await expect(canvas.getByText(labels.noMatchesTitle)).toBeInTheDocument();
    await expect(canvas.queryByRole("list", { name: labels.list })).toBeNull();
  },
};

/** The Member is on no Project: an empty state, with "New project" for someone who may create one. */
export const Empty: Story = {
  args: { projects: [], emptyAction: <Button>New project</Button> },
  play: async ({ canvas, globals }) => {
    const labels = projectsBrowserLabels[globals.locale === "ar" ? "ar" : "en"];
    await expect(canvas.getByText(labels.emptyTitle)).toBeInTheDocument();
    await expect(canvas.queryByRole("searchbox")).toBeNull();
  },
};

/** Narrow: one column, search and chips wrap, nothing scrolls sideways. */
export const Narrow: Story = {
  parameters: phone,
  play: async ({ canvasElement }) => {
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);
  },
};
