import type { ProjectSummary } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { projectCardsLabels } from "../../storybook/views.ts";
import { ProjectCard, ProjectCards } from "./project-cards.tsx";

// The Projects page, the home page (RP-346), as a Contractor engineer of
// Tamkeen sees it: each Project card with its Submittals and Need My Action
// counts. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  list: b("Projects", "المشاريع"),
  closed: b("Closed", "مغلق"),
  projectAdmin: b("Project Admin", "مسؤول المشروع"),
};

const project = (n: number, rest: Partial<ProjectSummary>): ProjectSummary => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
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
  project(3, { code: "JED7", name: b("Jeddah Waterfront Villas, Phase 7", "فلل واجهة جدة البحرية، المرحلة 7"), needMyAction: 0 }),
  project(4, { code: "DMM", name: b("Dammam Logistics Hub", "مركز الدمام اللوجستي"), status: "closed", needMyAction: 0 }),
];

// Each Project's Submittals the Member sees (the Projects answer's `submittals`).
const counts: Record<string, number> = Object.fromEntries(projects.map((p, i) => [p.id, [48, 31, 0, 204][i]!]));

const meta = {
  title: "Views/ProjectCards",
  component: ProjectCards,
  args: { projects, locale: "en", labels: projectCardsLabels.en, href: (id: string) => `#/projects/${id}`, submittals: counts },
  render: (args, context) => <ProjectCards {...args} locale={storyLocale(context)} labels={projectCardsLabels[storyLocale(context)]} />,
} satisfies Meta<typeof ProjectCards>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const cardOf = (context: PlayContext, name: { en: string; ar: string }) =>
  context.canvas.getByRole("link", { name: new RegExp(storyText(context, name).replace(/[.,]/g, "\\$&")) });

/**
 * Wide: one card per Project, each a link with its Submittals and Need My
 * Action counts. A Project with nothing waiting on me says 0; a closed Project
 * says Closed. Project codes read left to right, in Arabic too. No date, no
 * progress, no health chip.
 */
export const Wide: Story = {
  play: async (context) => {
    const list = context.canvas.getByRole("list", { name: storyText(context, copy.list) });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(projects.length);
    const tower = cardOf(context, projects[0]!.name);
    await expect(tower).toHaveAttribute("href", `#/projects/${projects[0]!.id}`);
    await expect(within(tower).getByText(storyText(context, b("12 need my action", "12 بحاجة لإجرائي")))).toBeVisible();
    await expect(within(tower).getByText(storyText(context, b("48 submittals", "48 تقديمات")))).toBeVisible();
    await expect(within(cardOf(context, projects[2]!.name)).getByText(storyText(context, b("0 need my action", "0 بحاجة لإجرائي")))).toBeVisible();
    const closed = cardOf(context, projects[3]!.name);
    await expect(closed).toHaveAccessibleDescription(expect.stringContaining(storyText(context, copy.closed)));
    await expect(within(tower).getByText(storyText(context, b("Tamkeen Contracting", "تمكين للمقاولات")))).toBeInTheDocument();
    // No date, no progress, no health chip (Rabaed has no time axis).
    await expect(within(tower).queryByText(/%|on track|at risk|overdue/i)).toBeNull();
    const code = within(tower).getByText("TWR");
    await expect(getComputedStyle(code).direction).toBe("ltr");
    await expectLaidOutLeftToRight(within(cardOf(context, projects[1]!.name)).getByText("KAFD2"));
  },
};

/** On Home (RP-407): the same card, with how many Submittals the Member sees there. */
export const OnHome: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[18px]">
        {projects.slice(0, 3).map((p, i) => (
          <li key={p.id} className="flex">
            <ProjectCard project={p} locale={locale} labels={projectCardsLabels[locale]} href={args.href(p.id)} submittals={[48, 1, 0][i]} />
          </li>
        ))}
      </ul>
    );
  },
  play: async (context) => {
    await expect(within(cardOf(context, projects[0]!.name)).getByText(storyText(context, b("48 submittals", "48 تقديمات")))).toBeVisible();
  },
};

const longRole = b("Owner Representative of the Eastern Region Programme", "ممثل المالك لبرنامج المنطقة الشرقية");

/**
 * A closed Project is the Active card with a grey chip. Its Company's role sits
 * on a line of its own, never cut short, however long.
 */
export const ClosedWithALongRole: Story = {
  args: {
    projects: [
      project(5, { code: "CLOSED1", status: "closed", projectRole: { baseRole: "owner_representative", name: longRole }, isProjectAdmin: true }),
    ],
    submittals: { [project(5, {}).id]: 7 },
  },
  play: async (context) => {
    const card = context.canvas.getByRole("link");
    const role = within(card).getByText(new RegExp(storyText(context, longRole)));
    await expect(role.scrollWidth).toBeLessThanOrEqual(role.clientWidth);
    await expect(getComputedStyle(role).textOverflow).not.toBe("ellipsis");
    await expect(within(card).getByText(storyText(context, copy.closed))).toBeVisible();
    await expect(within(card).getByText(storyText(context, b("7 submittals", "7 تقديمات")))).toBeVisible();
    await expectLaidOutLeftToRight(within(card).getByText("CLOSED1"));
  },
};

/** Narrow: the cards stack, each a touch target. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    const cards = within(context.canvas.getByRole("list", { name: storyText(context, copy.list) })).getAllByRole("link");
    const [first, second] = cards.map((c) => c.getBoundingClientRect());
    await expect(second!.top).toBeGreaterThanOrEqual(first!.bottom);
    await expectTouchTarget(cards[0]!);
  },
};
