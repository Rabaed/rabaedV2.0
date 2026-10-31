import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Button } from "../button/button.tsx";
import { CodeTile, StepAgePill, WorkItemActionsCard, WorkItemResultCard } from "./page-parts.tsx";

// The Work Item page's parts (RP-1151, gap table rows 16, 23–33), as the owner's design draws them
// in the rail: the Actions card in its states, and the result card after a Code. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  actions: b("Actions", "الإجراءات"),
  step: b("Review & issue Code", "المراجعة وإصدار الرمز"),
  pool: b("Design Consultants LLC · not picked up yet: Mohammed Al Shamsi", "ديزاين للاستشارات · لم يُستلم بعد: محمد الشامسي"),
  pickUp: b("Pick up", "استلام"),
  pickUpHelp: b("Pick it up to issue the Code.", "استلمها لإصدار الرمز."),
  holder: b("Mohammed Al Shamsi (you)", "محمد الشامسي (أنت)"),
  returnToPool: b("Return to pool", "إعادة للمجموعة"),
  approve: b("Approve – Code A", "اعتماد – الرمز A"),
  revise: b("Revise & Resubmit – Code C", "تعديل وإعادة تقديم – الرمز C"),
  none: b("Nothing for you to do while it is with the Consultant.", "لا شيء عليك بينما العنصر لدى الاستشاري."),
  withConsultant: b("Design Consultants LLC", "ديزاين للاستشارات"),
  createRevision: b("Create Revision", "إنشاء مراجعة"),
  revisionText: b("Code C ended this item. Start Revision 1 from its Form; the number gets Rev 1 when you Submit.", "أنهى الرمز C هذا العنصر. ابدأ المراجعة 1 من نموذجه؛ يأخذ الرقم Rev 1 عند التقديم."),
  result: b("Revise & Resubmit", "تعديل وإعادة تقديم"),
  issued: b("Review Code issued · 30 Oct 2026, 10:10", "صدر رمز المراجعة · 30 أكتوبر 2026، 10:10"),
  remarks: b("Separation between emergency and normal circuits is not shown.", "الفصل بين دوائر الطوارئ والدوائر العادية غير موضح."),
  signed: b("Signed by", "وقّعه"),
  signer: b("Mohammed Al Shamsi", "محمد الشامسي"),
  company: b("Design Consultants LLC", "ديزاين للاستشارات"),
  stepAge: b("2 weeks at this step", "أسبوعان في هذه الخطوة"),
};

const meta = {
  title: "Work Item page/Parts",
  component: WorkItemActionsCard,
  args: { title: "Actions", with: { step: "Review & issue Code", holder: null } },
  decorators: [(Story) => <div className="max-w-[340px]">{Story()}</div>],
} satisfies Meta<typeof WorkItemActionsCard>;

export default meta;
type Story = StoryObj<typeof meta>;
type Ctx = { globals: Record<string, unknown> };
const text = (context: Ctx, t: { en: string; ar: string }) => storyText(context, t);

/** Waiting in the viewer's pool: who it waits on, and Pick up (never "Claim": that is a payment request). */
export const Pooled: Story = {
  render: (_args, context) => (
    <WorkItemActionsCard
      title={text(context, copy.actions)}
      with={{ step: text(context, copy.step), holder: text(context, copy.pool), unclaimed: true }}
      transitions={<Button>{text(context, copy.pickUp)}</Button>}
      none={text(context, copy.pickUpHelp)}
    />
  ),
  play: async (context) => {
    const card = context.canvas.getByRole("region", { name: text(context, copy.actions) });
    await expect(within(card).getByText(text(context, copy.pool))).toBeVisible();
    await expect(within(card).getByRole("button", { name: text(context, copy.pickUp) })).toBeVisible();
    await expect(within(card).queryByText(/claim/i)).toBeNull();
  },
};

/** Picked up: the holder with Return to pool, and the Code Transitions stacked, each with its code tile. */
export const PickedUp: Story = {
  render: (_args, context) => (
    <WorkItemActionsCard
      title={text(context, copy.actions)}
      with={{ step: text(context, copy.step), holder: text(context, copy.holder), avatar: text(context, copy.signer), end: <Button variant="ghost" size="sm">{text(context, copy.returnToPool)}</Button> }}
      transitions={
        <>
          <Button variant="secondary" className="justify-start">
            <CodeTile code="A" />
            {text(context, copy.approve)}
          </Button>
          <Button variant="secondary" className="justify-start">
            <CodeTile code="C" />
            {text(context, copy.revise)}
          </Button>
        </>
      }
    />
  ),
  play: async (context) => {
    const card = context.canvas.getByRole("region", { name: text(context, copy.actions) });
    await expect(within(card).getByRole("button", { name: text(context, copy.returnToPool) })).toBeVisible();
    // The tile is decorative: each button is named by its Transition's label alone.
    await expect(within(card).getByRole("button", { name: text(context, copy.approve) })).toBeVisible();
    await expect(within(card).getByRole("button", { name: text(context, copy.revise) })).toBeVisible();
  },
};

/** With another Company: its name only (V14), and nothing for the viewer to do. */
export const NothingToDo: Story = {
  render: (_args, context) => (
    <WorkItemActionsCard title={text(context, copy.actions)} with={{ step: text(context, copy.withConsultant), holder: null }} none={text(context, copy.none)} />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(text(context, copy.none))).toBeVisible();
    await expect(context.canvas.queryByRole("button")).toBeNull();
  },
};

/** After Code C, for the raiser: the Create Revision card. */
export const CreateRevision: Story = {
  render: (_args, context) => (
    <WorkItemActionsCard
      title={text(context, copy.actions)}
      with={{ step: text(context, copy.result), holder: null, code: "C" }}
      revision={{ title: text(context, copy.createRevision), text: text(context, copy.revisionText), action: <Button>{text(context, copy.createRevision)}</Button> }}
    />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(text(context, copy.revisionText))).toBeVisible();
    await expect(context.canvas.getByRole("button", { name: text(context, copy.createRevision) })).toBeVisible();
  },
};

/** The result card after a Code: its tile, when, the Remarks and the signer, by name only (V14). */
export const ResultCard: Story = {
  render: (_args, context) => (
    <div className="w-[640px] max-w-full">
      <WorkItemResultCard
        code="C"
        title={text(context, copy.result)}
        issued={text(context, copy.issued)}
        remarks={text(context, copy.remarks)}
        signedBy={text(context, copy.signed)}
        signer={text(context, copy.signer)}
        company={text(context, copy.company)}
      />
    </div>
  ),
  play: async (context) => {
    const card = context.canvas.getByRole("region", { name: text(context, copy.result) });
    await expect(within(card).getByText(text(context, copy.remarks))).toBeVisible();
    await expect(within(card).getByText(text(context, copy.signer))).toBeVisible();
  },
};

/** Step Age in weeks, as dots and words: no due date, no days (CLAUDE.md). */
export const StepAge: Story = {
  render: (_args, context) => <StepAgePill weeks={2} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(context.canvas.getByText(text(context, copy.stepAge))).toBeVisible();
  },
};
