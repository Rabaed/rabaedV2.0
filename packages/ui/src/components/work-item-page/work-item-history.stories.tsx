import type { WorkItemHistory } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { workItemHistoryEntries } from "./history-model.ts";
import { WorkItemPageHistory, type WorkItemPageHistoryLabels } from "./work-item-history.tsx";

// The Work Item page's History (RP-1151, gap table rows 60–64), as the owner's design draws it in the
// rail: newest first, numbered, the viewer's own internal moves marked. Story data only.
type Event = WorkItemHistory["events"][number];
const b = (en: string, ar: string) => ({ en, ar });

const contractor = b("TMC Constructions", "تي إم سي للمقاولات");
const consultant = b("Design Consultants LLC", "ديزاين للاستشارات");

let seq = 0;
function event(over: Partial<Event> & Pick<Event, "type" | "audience">): Event {
  seq += 1;
  return {
    seq,
    at: `2026-10-2${seq}T09:00:00.000Z`,
    by: { companyName: null, memberName: null, positions: [] },
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
  };
}

const events = [
  event({ type: "transition", audience: "shared", transition: b("Submit", "تقديم"), by: { companyName: contractor, memberName: b("Ali Sonour", "علي سنور"), positions: [] } }),
  event({ type: "transition", audience: "internal", transition: b("Log & assign", "التسجيل والإسناد"), by: { companyName: consultant, memberName: b("Ahmed bin Said", "أحمد بن سعيد"), positions: [b("Reviewer", "مراجع")] } }),
  event({ type: "picked_up", audience: "internal", by: { companyName: consultant, memberName: b("Mohammed Al Shamsi", "محمد الشامسي"), positions: [] } }),
];

const copy = {
  title: b("History", "السجل"),
  internal: b("Internal: only your Company sees this", "داخلي: تراه شركتك فقط"),
  details: b("Details", "التفاصيل"),
  empty: b("Nothing has happened yet.", "لم يحدث شيء بعد."),
  picked: b("Picked up", "استلم"),
  submitDetails: b("Submit → Consultant review", "تقديم ← مراجعة الاستشاري"),
};

function labels(context: { globals: Record<string, unknown> }): WorkItemPageHistoryLabels {
  const text = (t: { en: string; ar: string }) => storyText(context, t);
  return {
    title: text(copy.title),
    move: (e) => e.transition?.[storyLocale(context)] ?? text(copy.picked),
    texts: { coverNote: "Cover Note", remarks: "Remarks", internalNote: "Internal Note", reason: "Reason" },
    internal: text(copy.internal),
    details: text(copy.details),
    empty: text(copy.empty),
  };
}

const meta = {
  title: "Work Item page/History",
  component: WorkItemPageHistory,
  args: { locale: "en", labels: labels({ globals: {} }), entries: [] },
} satisfies Meta<typeof WorkItemPageHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Consultant's reviewer reads it: their own internal moves marked, the Contractor's Submit by its Company only (V14). */
export const AsTheConsultant: Story = {
  render: (_args, context) => (
    <div className="max-w-[360px]">
      <WorkItemPageHistory
        locale={storyLocale(context)}
        labels={labels(context)}
        entries={workItemHistoryEntries({ events, viewerCompany: consultant })}
        details={(entry) => (entry.n === 1 ? storyText(context, copy.submitDetails) : null)}
      />
    </div>
  ),
  play: async (context) => {
    const list = context.canvas.getByRole("list", { name: storyText(context, copy.title) });
    const items = within(list).getAllByRole("listitem");
    await expect(items).toHaveLength(3);
    // Newest first, numbered from the oldest.
    await expect(within(items[0]!).getByText("3")).toBeVisible();
    await expect(within(items[2]!).getByText("1")).toBeVisible();
    // The two internal moves are marked; the shared Submit isn't.
    await expect(within(items[0]!).getByText(storyText(context, copy.internal))).toBeVisible();
    await expect(within(items[2]!).queryByText(storyText(context, copy.internal))).toBeNull();
    // Another Company's Submit: its Company, never its person (V14).
    await expect(within(items[2]!).getByText(storyText(context, contractor))).toBeVisible();
    await expect(within(items[2]!).queryByText(storyText(context, b("Ali Sonour", "علي سنور")))).toBeNull();
    // Its details fold behind "Details".
    const details = within(items[2]!).getByText(storyText(context, copy.details));
    await expect(within(items[2]!).getByText(storyText(context, copy.submitDetails))).not.toBeVisible();
    await userEvent.click(details);
    await expect(within(items[2]!).getByText(storyText(context, copy.submitDetails))).toBeVisible();
  },
};

/** Nothing yet: it says so. */
export const Empty: Story = {
  render: (_args, context) => <WorkItemPageHistory locale={storyLocale(context)} labels={labels(context)} entries={[]} />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.empty))).toBeVisible();
  },
};
