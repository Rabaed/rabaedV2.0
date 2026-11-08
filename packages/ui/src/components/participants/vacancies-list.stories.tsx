import type { Locale, ProjectVacancies } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { VacanciesList, type VacanciesListLabels } from "./vacancies-list.tsx";

// The Project's Vacancies, for the Host Company's Project Admin (RP-952): the Step each waits at,
// the role it waits for, and how long, in Step Age dots. An item the Admin sees is named; one they
// don't is only its Step and the Project (the owner's Q3, scenario RP-952-6). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const now = new Date("2026-11-08T09:00:00.000Z");
const consultant = { baseRole: "consultant" as const, name: b("Consultant", "الاستشاري") };
const vacancies: ProjectVacancies["vacancies"] = [
  {
    id: "00000000-0000-4000-8000-000000000a01",
    item: { id: "00000000-0000-4000-8000-000000000b01", documentNumber: "TWR-TMC-EL-MAR-042", title: "Linear LED fixtures" },
    projectRole: consultant,
    step: { name: b("Consultant review", "مراجعة الاستشاري") },
    vacantSince: "2026-10-30T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000a02",
    item: null,
    projectRole: consultant,
    step: { name: b("Consultant Engineer review", "مراجعة مهندس الاستشاري") },
    vacantSince: "2026-10-01T09:00:00.000Z",
  },
];
const copy = {
  waiting: b("Waiting for a new Consultant", "بانتظار الاستشاري الجديد"),
  hidden: b("An item at Consultant Engineer review on Riyadh Gate Tower", "عنصر عند مراجعة مهندس الاستشاري في برج بوابة الرياض"),
  empty: b("No Step is waiting for a new Participant.", "لا توجد خطوة بانتظار مشارك جديد."),
};

function labelsFor(locale: Locale): VacanciesListLabels {
  const en = locale === "en";
  return {
    description: en ? "Steps whose Company was withdrawn. Each waits for a new Participant in its Project Role." : "خطوات سُحبت شركتها. تنتظر كل منها مشاركًا جديدًا بدورها.",
    waitingFor: (role) => (en ? `Waiting for a new ${role}` : `بانتظار ${role} الجديد`),
    hiddenItem: (step, project) => (en ? `An item at ${step} on ${project}` : `عنصر عند ${step} في ${project}`),
    noNumber: en ? "No number yet" : "بلا رقم بعد",
    empty: copy.empty[locale],
  };
}

const meta = {
  title: "Participants/Vacancies",
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="max-w-[880px] p-4">
        <VacanciesList
          vacancies={args.empty ? [] : vacancies}
          projectName={locale === "en" ? "Riyadh Gate Tower" : "برج بوابة الرياض"}
          now={now}
          locale={locale}
          labels={labelsFor(locale)}
          hrefFor={(id) => `#work-items/${id}`}
        />
      </div>
    );
  },
} satisfies Meta<{ empty?: boolean }>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One Vacancy on an item the Admin sees (a link, its number left-to-right), one on an item they don't (its Step and the Project only). */
export const Listed: Story = {
  play: async (context) => {
    const list = within(context.canvasElement).getByRole("list");
    const [seen, unseen] = within(list).getAllByRole("listitem");
    await expect(within(seen!).getByRole("link", { name: /Linear LED fixtures/ })).toHaveAttribute("href", "#work-items/00000000-0000-4000-8000-000000000b01");
    await expect(within(seen!).getByText("TWR-TMC-EL-MAR-042").closest("bdi")).toHaveAttribute("dir", "ltr");
    await expect(within(seen!).getByText(storyText(context, copy.waiting))).toBeVisible();
    // The unseen one: no link, no number, no Subject; only the Step, the Project and the role.
    await expect(within(unseen!).queryByRole("link")).toBeNull();
    await expect(within(unseen!).getByText(storyText(context, copy.hidden))).toBeVisible();
    await expect(within(unseen!).getByText(storyText(context, copy.waiting))).toBeVisible();
    // Step Age dots, never a date or "overdue": 2 weeks and 6 weeks (4+).
    await expect(within(seen!).getByRole("img").querySelectorAll("[data-filled]")).toHaveLength(2);
    await expect(within(unseen!).getAllByRole("img").at(-1)!.querySelectorAll("[data-filled]")).toHaveLength(4);
  },
};

/** None left: a quiet line, never an empty card. */
export const Empty: Story = {
  args: { empty: true },
  play: async (context) => {
    await expect(within(context.canvasElement).getByText(storyText(context, copy.empty))).toBeVisible();
  },
};
