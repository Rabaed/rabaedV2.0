import type { ProjectSummary } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { ProjectCards } from "./project-cards.tsx";

// The Projects page, the home page (RP-346), as a Contractor engineer of
// Tamkeen sees it: each Project card with its Need My Action count. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  list: b("My Projects", "مشاريعي"),
  needMyAction: b("Need My Action", "بحاجة لإجرائي"),
  closed: b("Closed", "مغلق"),
  projectAdmin: b("Project Admin", "مسؤول المشروع"),
};

const project = (n: number, rest: Partial<ProjectSummary>): ProjectSummary => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  projectNumber: n,
  code: "TWR",
  name: b("Riyadh Gate Tower", "برج بوابة الرياض"),
  status: "active",
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

const meta = {
  title: "Views/ProjectCards",
  component: ProjectCards,
  args: { projects, locale: "en", href: (id: string) => `#/projects/${id}` },
  render: (args, context) => <ProjectCards {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof ProjectCards>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const cardOf = (context: PlayContext, name: { en: string; ar: string }) =>
  context.canvas.getByRole("link", { name: new RegExp(storyText(context, name).replace(/[.,]/g, "\\$&")) });

/**
 * Wide: one card per Project, each a link with its Need My Action count. A
 * Project with nothing waiting on me says 0; a closed Project says Closed.
 * Project codes read left to right, in Arabic too.
 */
export const Wide: Story = {
  play: async (context) => {
    const list = context.canvas.getByRole("list", { name: storyText(context, copy.list) });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(projects.length);
    const needMyAction = storyText(context, copy.needMyAction);
    const tower = cardOf(context, projects[0]!.name);
    await expect(tower).toHaveAttribute("href", `#/projects/${projects[0]!.id}`);
    await expect(tower).toHaveAccessibleDescription(expect.stringContaining(`${needMyAction}: 12`));
    await expect(cardOf(context, projects[2]!.name)).toHaveAccessibleDescription(expect.stringContaining(`${needMyAction}: 0`));
    const closed = cardOf(context, projects[3]!.name);
    await expect(closed).toHaveAccessibleDescription(expect.stringContaining(storyText(context, copy.closed)));
    const code = within(tower).getByText("TWR");
    await expect(getComputedStyle(code).direction).toBe("ltr");
    await expectLaidOutLeftToRight(within(cardOf(context, projects[1]!.name)).getByText("KAFD2"));
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
