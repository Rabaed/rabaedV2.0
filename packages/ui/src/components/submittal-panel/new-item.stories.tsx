import type { BaseRole, DraftsVisibleTo, Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { submittalOwnerWorkflow } from "../../storybook/submittal-route.ts";
import { workflowStages } from "../../storybook/workflow.ts";
import { Button } from "../button/button.tsx";
import {
  BeforeYouSend,
  DiscardDraftDialog,
  DraftWhoSees,
  LockedDocuments,
  NewItemFooter,
  NewItemIdentity,
  NewItemRoutePreview,
  NewItemSectionBar,
  NewItemTypeCards,
  RequiredChecklist,
  type NewItemRoutePreviewLabels,
  type NewItemType,
} from "./new-item.tsx";
import type { NewItemRequiredItem } from "./new-item-model.ts";
import { submittalRoute } from "./route-model.ts";

// The create panel's parts (RP-1152), one story each, in English and Arabic. Story data only: the
// API decides what the viewer may know; these check that the parts never add another Company's
// name or a person's.

type Bi = Record<Locale, string>;
const bi = (en: string, ar: string): Bi => ({ en, ar });

const copy = {
  types: bi("The Types you may raise", "الأنواع التي يمكنك إنشاؤها"),
  noNumber: bi("No number yet", "بلا رقم بعد"),
  draft: bi("Draft", "مسودة"),
  subject: bi("Subject", "الموضوع"),
  subjectPlaceholder: bi("Subject *  e.g. LED light fixtures — Tower 2", "الموضوع *  مثال: وحدات إنارة LED — البرج 2"),
  onlyYou: bi("Only you see this Draft until it is Submitted.", "أنت وحدك ترى هذه المسودة حتى تقديمها."),
  onlyCompany: bi("Only your Company sees this Draft until it is Submitted.", "شركتك وحدها ترى هذه المسودة حتى تقديمها."),
  whoSees: bi("Who sees this Draft", "من يرى هذه المسودة"),
  required: bi("Required before Send for Review", "مطلوب قبل الإرسال للمراجعة"),
  incomplete: bi("A Draft can be saved incomplete. You send it from the Work Item page.", "يمكن حفظ المسودة ناقصة. ترسلها من صفحة عنصر العمل."),
  workflow: bi("Workflow after you send", "سير العمل بعد الإرسال"),
  now: bi("Now · you", "الآن · أنت"),
  private: bi("Steps inside are private", "الخطوات الداخلية خاصة"),
  outcome: bi("Close or Revise", "إغلاق أو مراجعة"),
  before: bi("Before you send", "قبل الإرسال"),
  collapseAll: bi("Collapse all", "طي الكل"),
  expandAll: bi("Expand all", "توسيع الكل"),
  locked: bi("Save the Draft first, then add Documents.", "احفظ المسودة أولًا، ثم أضف المستندات."),
  add: bi("Add", "إضافة"),
  notSaved: bi("Not saved yet", "لم يُحفظ بعد"),
  cancel: bi("Cancel", "إلغاء"),
  saveDraft: bi("Save Draft", "حفظ المسودة"),
  openPage: bi("Open Work Item page", "فتح صفحة عنصر العمل"),
  discardTitle: bi("Discard this Draft?", "تجاهل هذه المسودة؟"),
  discardBody: bi("Nothing has been saved.", "لم يُحفظ شيء."),
  discard: bi("Discard", "تجاهل"),
  keep: bi("Keep editing", "متابعة التحرير"),
  close: bi("Close", "إغلاق"),
};

const roles: Record<BaseRole, Bi> = {
  contractor: bi("Contractor", "المقاول"),
  consultant: bi("Consultant", "الاستشاري"),
  owner: bi("Owner", "المالك"),
  owner_representative: bi("Owner's Representative", "ممثل المالك"),
};

const types: NewItemType[] = [
  { code: "MAR", name: bi("Material Approval Request", "طلب اعتماد مواد"), description: bi("Materials and products for approval", "المواد والمنتجات للاعتماد") },
  { code: "SAR", name: bi("Shop Drawing Approval Request", "طلب اعتماد مخططات تنفيذية"), description: bi("Shop drawings for approval", "المخططات التنفيذية للاعتماد") },
  { code: "DAR", name: bi("Document Approval Request", "طلب اعتماد مستند"), description: null },
];

const ownCompany = bi("TMC Constructions", "تي إم سي للمقاولات");

const required = (locale: Locale): NewItemRequiredItem[] => [
  { key: "subject", label: bi("Subject", "الموضوع")[locale], done: true },
  { key: "trade", label: bi("Trade", "التخصص")[locale], done: true },
  { key: "approved_supplier", label: bi("Approved supplier", "المورد المعتمد")[locale], done: false },
  { key: "location", label: bi("Location", "الموقع")[locale], done: false },
];

const routeLabels = (locale: Locale): NewItemRoutePreviewLabels => ({
  role: (role) => roles[role][locale],
  route: copy.workflow[locale],
  now: copy.now[locale],
  review: (role) => (locale === "ar" ? `مراجعة ${roles[role].ar}` : `${roles[role].en} review`),
  private: copy.private[locale],
  outcome: copy.outcome[locale],
});

/** The Rabaed Default "Submittal 2→2 with the Owner's review", from its Draft Step. */
const draftRoute = submittalRoute({ definition: submittalOwnerWorkflow, stages: workflowStages, position: { kind: "own", stepKey: "draft" } });

const meta = { title: "Views/Submittal Panel/New item" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function TypeCardsDemo({ context, list }: { context: StoryContext; list: NewItemType[] }) {
  const locale = storyLocale(context);
  const [value, setValue] = useState(list[0]!.code);
  // Inside a Wide panel's column (`@container/sdp`), where the cards once sat side by side.
  return (
    <div className="@container/sdp w-[960px] max-w-full">
      <NewItemTypeCards locale={locale} heading={copy.types[locale]} types={list} value={value} onChange={setValue} className="p-5" />
    </div>
  );
}

/** One card per Type (rows 17–19): name and code, the one-line description, a check on the chosen one; a click chooses another. */
export const TypeCards: Story = {
  render: (_args, context) => <TypeCardsDemo context={context} list={types} />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    const group = canvas.getByRole("group", { name: storyText(context, copy.types) });
    const cards = within(group).getAllByRole("button");
    await expect(cards).toHaveLength(3);
    await expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    await expect(cards[0]).toHaveTextContent(`${storyText(context, types[0]!.name)} (MAR)`);
    await expect(cards[0]).toHaveTextContent(storyText(context, types[0]!.description!));
    // One vertical stack, each card the column's full width (row 17, `.nwtype`).
    const boxes = cards.map((card) => card.getBoundingClientRect());
    const column = group.getBoundingClientRect();
    await expect(boxes.every((box) => Math.abs(box.width - column.width) < 1 && Math.abs(box.left - column.left) < 1)).toBe(true);
    await expect(boxes.every((box, i) => i === 0 || box.top >= boxes[i - 1]!.bottom)).toBe(true);
    await userEvent.click(cards[1]!);
    await expect(cards[1]).toHaveAttribute("aria-pressed", "true");
    await expect(cards[0]).toHaveAttribute("aria-pressed", "false");
    // "Material Submittal" is the reference's term, never ours.
    await expect(group).not.toHaveTextContent(/Material Submittal/);
  },
};

/** A single Type: one selected card (decision 2). */
export const SingleType: Story = {
  render: (_args, context) => <TypeCardsDemo context={context} list={[types[0]!]} />,
  play: async (context) => {
    const cards = within(context.canvasElement).getAllByRole("button");
    await expect(cards).toHaveLength(1);
    await expect(cards[0]).toHaveAttribute("aria-pressed", "true");
  },
};

function IdentityDemo({ context }: { context: StoryContext }) {
  const locale = storyLocale(context);
  const [subject, setSubject] = useState("");
  return (
    <NewItemIdentity
      locale={locale}
      noNumber={copy.noNumber[locale]}
      draft={copy.draft[locale]}
      subject={subject}
      onSubjectChange={setSubject}
      subjectLabel={copy.subject[locale]}
      placeholder={copy.subjectPlaceholder[locale]}
    />
  );
}

/** "No number yet", the Draft chip and the large Subject input (rows 15, 16): at most 200 characters, named "Subject". */
export const Identity: Story = {
  render: (_args, context) => <IdentityDemo context={context} />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    await expect(canvas.getByText(storyText(context, copy.noNumber))).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.draft))).toBeVisible();
    const subject = canvas.getByRole("textbox", { name: storyText(context, copy.subject) });
    await expect(subject).toHaveAttribute("maxLength", "200");
    // Empty, it reads in the page's direction, so the Arabic placeholder starts at the right (rows 14, 16);
    // typed text still takes its own direction from its first letter.
    await expect(subject).toHaveAttribute("dir", storyLocale(context) === "ar" ? "rtl" : "ltr");
    await expect(getComputedStyle(subject).unicodeBidi).toBe("plaintext");
    await expect(getComputedStyle(subject).textAlign).toBe("start");
    await userEvent.type(subject, "LED light fixtures");
    await expect(subject).toHaveValue("LED light fixtures");
  },
};

function WhoSeesDemo({ context, look, visibleTo }: { context: StoryContext; look: "banner" | "box"; visibleTo: DraftsVisibleTo | null }) {
  const locale = storyLocale(context);
  return (
    <div className="max-w-[360px] p-5">
      <DraftWhoSees
        look={look}
        draftsVisibleTo={visibleTo}
        companyName={ownCompany[locale]}
        labels={{ author: copy.onlyYou[locale], company: copy.onlyCompany[locale], heading: copy.whoSees[locale] }}
      />
    </div>
  );
}

/** The banner under the Type (row 20), "Drafts visible to: author": only you. */
export const WhoSeesBannerAuthor: Story = {
  render: (_args, context) => <WhoSeesDemo context={context} look="banner" visibleTo="author" />,
  play: async (context) => {
    const banner = context.canvasElement.querySelector<HTMLElement>("[data-draft-who-sees]")!;
    await expect(banner).toHaveTextContent(storyText(context, copy.onlyYou));
    await expect(banner.querySelector("svg")).not.toBeNull();
    await expect(banner).not.toHaveTextContent(storyText(context, ownCompany));
  },
};

/** The rail's box (row 21): the viewer's own Company and "only your Company"; no other Company is ever named (V15). Unset reads as company. */
export const WhoSeesBox: Story = {
  render: (_args, context) => <WhoSeesDemo context={context} look="box" visibleTo={null} />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    await expect(canvas.getByRole("heading", { name: storyText(context, copy.whoSees) })).toBeVisible();
    const box = context.canvasElement.querySelector<HTMLElement>("[data-draft-who-sees]")!;
    await expect(box).toHaveTextContent(storyText(context, ownCompany));
    await expect(box).toHaveTextContent(storyText(context, copy.onlyCompany));
    await expect(box).not.toHaveTextContent(/Design Consultants|ديزاين/);
  },
};

/** The checklist (rows 25, 33): "2/4", each field ticked or not, and the line that a Draft can be saved incomplete. */
export const Checklist: Story = {
  render: (_args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="max-w-[300px] p-5">
        <RequiredChecklist locale={locale} heading={copy.required[locale]} items={required(locale)} incomplete={copy.incomplete[locale]} />
      </div>
    );
  },
  play: async (context) => {
    const canvas = within(context.canvasElement);
    const list = canvas.getByRole("list", { name: storyText(context, copy.required) });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    await expect(list.querySelectorAll("[data-done]")).toHaveLength(2);
    await expect(canvas.getByText("2/4")).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.incomplete))).toBeVisible();
  },
};

/**
 * The route preview (rows 34, 35; decision 3): role chips; the viewer's own Steps by name, the
 * Draft Step "Now · you", later ones by role; every other role one private row; the outcome by
 * role. Never a person's name, never a Company's.
 */
export const RoutePreview: Story = {
  render: (_args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="max-w-[320px] p-5">
        <NewItemRoutePreview locale={locale} route={draftRoute} labels={routeLabels(locale)} />
      </div>
    );
  },
  play: async (context) => {
    const canvas = within(context.canvasElement);
    const t = (text: Bi) => storyText(context, text);
    const chips = within(canvas.getByRole("list", { name: t(copy.workflow) })).getAllByRole("listitem");
    await expect(chips.map((chip) => chip.textContent)).toEqual([t(roles.contractor), t(roles.consultant), t(roles.owner), t(roles.contractor)]);
    await expect(chips[0]).toHaveAttribute("aria-current", "step");

    const rows = context.canvasElement.querySelectorAll<HTMLElement>("[data-route-row]");
    await expect([...rows].map((row) => row.dataset.routeRow)).toEqual(["step", "step", "step", "private", "private", "outcome"]);
    await expect(rows[0]).toHaveTextContent(t(bi("Draft", "مسودة")));
    await expect(rows[0]).toHaveTextContent(t(copy.now));
    await expect(rows[0]).toHaveAttribute("aria-current", "step");
    await expect(rows[1]).toHaveTextContent(t(roles.contractor));
    await expect(rows[3]).toHaveTextContent(storyLocale(context) === "ar" ? "مراجعة الاستشاري" : "Consultant review");
    await expect(rows[3]).toHaveTextContent(t(copy.private));
    await expect(rows[5]).toHaveTextContent(`${t(copy.outcome)}${t(roles.contractor)}`);
    await expect(context.canvasElement).not.toHaveTextContent(/Design Consultants|Hafiz|Ali Sonour|TMC/);
  },
};

function BeforeDemo({ context }: { context: StoryContext }) {
  const locale = storyLocale(context);
  return (
    <div className="max-w-[640px] p-5">
      <BeforeYouSend
        heading={copy.before[locale]}
        checklist={<RequiredChecklist locale={locale} heading={copy.required[locale]} items={required(locale)} />}
        route={<NewItemRoutePreview locale={locale} route={draftRoute} labels={routeLabels(locale)} heading={copy.workflow[locale]} />}
      />
    </div>
  );
}

/** "Before you send" (row 12): the checklist and route in the flow, folded and unfolded like a Form Section. */
export const BeforeYouSendBlock: Story = {
  render: (_args, context) => <BeforeDemo context={context} />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    const toggle = canvas.getByRole("button", { name: storyText(context, copy.before) });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("list", { name: storyText(context, copy.required) })).toBeVisible();
    await expect(context.canvasElement.querySelector(".sdp-inflow")).not.toBeNull();
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("list", { name: storyText(context, copy.required) })).toBeNull();
  },
};

function SectionBarDemo({ context }: { context: StoryContext }) {
  const locale = storyLocale(context);
  const [folded, setFolded] = useState(false);
  return (
    <NewItemSectionBar
      locale={locale}
      sections={5}
      required={{ done: 0, total: 7 }}
      labels={{
        summary: (sections, done, total) => (locale === "ar" ? `${sections} أقسام نموذج · ${done}/${total} من المطلوب مكتمل` : `${sections} Form Sections · ${done}/${total} required filled`),
        collapseAll: copy.collapseAll[locale],
        expandAll: copy.expandAll[locale],
      }}
      allCollapsed={folded}
      onToggleAll={() => setFolded(!folded)}
    />
  );
}

/** The bar over the Form Sections (row 23): how many, how many required are filled, and Collapse all / Expand all. */
export const SectionBar: Story = {
  render: (_args, context) => <SectionBarDemo context={context} />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    await expect(context.canvasElement).toHaveTextContent(storyLocale(context) === "ar" ? "5 أقسام نموذج · 0/7" : "5 Form Sections · 0/7 required filled");
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.collapseAll) }));
    await expect(canvas.getByRole("button", { name: storyText(context, copy.expandAll) })).toBeVisible();
  },
};

/** Documents before the first save (row 29): the lock line, and a greyed slot per Documents field with its hint. */
export const DocumentsLocked: Story = {
  render: (_args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="max-w-[560px] p-5">
        <LockedDocuments
          labels={{ locked: copy.locked[locale], add: copy.add[locale] }}
          slots={[
            { key: "datasheet", label: bi("Datasheet (PDF)", "ورقة البيانات (PDF)")[locale], hint: bi("PDF or image", "PDF أو صورة")[locale] },
            { key: "certificate", label: bi("Test certificate", "شهادة الاختبار")[locale], hint: bi("PDF or image", "PDF أو صورة")[locale] },
            { key: "photo", label: bi("Sample photo", "صورة العينة")[locale], hint: bi("Time and place are read from the photo", "يُقرأ الوقت والمكان من الصورة")[locale] },
          ]}
        />
      </div>
    );
  },
  play: async (context) => {
    const canvas = within(context.canvasElement);
    await expect(canvas.getByText(storyText(context, copy.locked))).toBeVisible();
    const slots = context.canvasElement.querySelectorAll("[data-slot]");
    await expect(slots).toHaveLength(3);
    for (const button of canvas.getAllByRole("button", { name: new RegExp(storyText(context, copy.add)) })) await expect(button).toBeDisabled();
  },
};

function FooterDemo({ context, savedAt, layout }: { context: StoryContext; savedAt: string | null; layout?: "page" }) {
  const locale = storyLocale(context);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">
      <NewItemFooter
        layout={layout}
        savedAt={savedAt}
        openHref="#/work-items/42"
        onCancel={fn()}
        onSave={fn()}
        labels={{
          notSaved: copy.notSaved[locale],
          saved: (time) => (locale === "ar" ? `حُفظ ${time}` : `Saved ${time}`),
          cancel: copy.cancel[locale],
          saveDraft: copy.saveDraft[locale],
          openPage: copy.openPage[locale],
        }}
      />
    </div>
  );
}

/** Before the first save (row 36): "Not saved yet", Cancel, and Save Draft, the primary, last. */
export const FooterNotSaved: Story = {
  render: (_args, context) => <FooterDemo context={context} savedAt={null} />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    await expect(canvas.getByText(storyText(context, copy.notSaved))).toBeVisible();
    const buttons = canvas.getAllByRole("button");
    await expect(buttons.map((b) => b.textContent)).toEqual([storyText(context, copy.cancel), storyText(context, copy.saveDraft)]);
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};

/** After it (rows 38, 39): "Saved 10:42", the Work Item page link, and Save Draft as "save now". */
export const FooterSaved: Story = {
  render: (_args, context) => <FooterDemo context={context} savedAt="10:42" />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    await expect(context.canvasElement).toHaveTextContent(storyLocale(context) === "ar" ? "حُفظ 10:42" : "Saved 10:42");
    await expect(canvas.getByRole("link", { name: storyText(context, copy.openPage) })).toHaveAttribute("href", "#/work-items/42");
    await expect(canvas.queryByRole("button", { name: storyText(context, copy.cancel) })).toBeNull();
    await expect(canvas.getByRole("button", { name: storyText(context, copy.saveDraft) })).toBeVisible();
  },
};

/** On the phone (row 7): no Cancel; the Work Item page link is an icon, still named. */
export const FooterPhone: Story = {
  parameters: { phone: true },
  render: (_args, context) => <FooterDemo context={context} savedAt="10:42" layout="page" />,
  play: async (context) => {
    const canvas = within(context.canvasElement);
    const link = canvas.getByRole("link", { name: storyText(context, copy.openPage) });
    await expect(link).not.toHaveTextContent(storyText(context, copy.openPage));
    await expect(canvas.queryByRole("button", { name: storyText(context, copy.cancel) })).toBeNull();
  },
};

function DiscardDemo({ context, onDiscard }: { context: StoryContext; onDiscard: () => void }) {
  const locale = storyLocale(context);
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{copy.cancel[locale]}</Button>
      <DiscardDraftDialog
        open={open}
        onOpenChange={setOpen}
        onDiscard={onDiscard}
        labels={{ title: copy.discardTitle[locale], description: copy.discardBody[locale], discard: copy.discard[locale], keep: copy.keep[locale], close: copy.close[locale] }}
      />
    </>
  );
}

const discarded = fn();

/** Cancel with typed answers before the first save (row 37): asks before discarding; Discard calls back. */
export const DiscardDialog: Story = {
  parameters: overlay,
  render: (_args, context) => <DiscardDemo context={context} onDiscard={discarded} />,
  play: async (context) => {
    discarded.mockClear();
    const dialog = await within(document.body).findByRole("alertdialog", { name: storyText(context, copy.discardTitle) });
    await expect(dialog).toHaveTextContent(storyText(context, copy.discardBody));
    await expect(within(dialog).getByRole("button", { name: storyText(context, copy.keep) })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: storyText(context, copy.discard) }));
    await expect(discarded).toHaveBeenCalledOnce();
    await waitFor(() => expect(within(document.body).queryByRole("alertdialog")).toBeNull());
    // Reopened, for the screenshot.
    await userEvent.click(within(context.canvasElement).getByRole("button", { name: storyText(context, copy.cancel) }));
    await within(document.body).findByRole("alertdialog", { name: storyText(context, copy.discardTitle) });
  },
};
