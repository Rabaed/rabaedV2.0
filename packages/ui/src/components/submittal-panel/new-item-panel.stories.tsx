import type { BaseRole, Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { submittalOwnerWorkflow } from "../../storybook/submittal-route.ts";
import { workflowStages } from "../../storybook/workflow.ts";
import { Button } from "../button/button.tsx";
import { ToastProvider, useToast } from "../overlay/toast.tsx";
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
} from "./new-item.tsx";
import { newItemRequired } from "./new-item-model.ts";
import { SubmittalPanelGrip, SubmittalPanelSizeSwitch, useSubmittalPanelSize, type SubmittalPanelSizeLabels } from "./panel-resize.tsx";
import { submittalRoute } from "./route-model.ts";
import { SubmittalPanel, useSubmittalPanelIds, type SubmittalPanelLayout } from "./submittal-panel.tsx";

// The create panel put together from its parts (RP-1152), as the web host will: Wide with the
// rail, Normal with "Before you send" in the flow, and the phone's page after a save. Story data
// only; the host's wiring (create, autosave, the List row) comes later.

type Bi = Record<Locale, string>;
const bi = (en: string, ar: string): Bi => ({ en, ar });

const copy = {
  module: bi("Submittals", "التقديمات"),
  crumb: bi("New Material Approval Request", "طلب اعتماد مواد جديد"),
  close: bi("Close", "إغلاق"),
  back: bi("Back to Submittals", "العودة إلى التقديمات"),
  types: bi("The Types you may raise", "الأنواع التي يمكنك إنشاؤها"),
  noNumber: bi("No number yet", "بلا رقم بعد"),
  draft: bi("Draft", "مسودة"),
  subject: bi("Subject", "الموضوع"),
  placeholder: bi("Subject *  e.g. LED light fixtures — Tower 2", "الموضوع *  مثال: وحدات إنارة LED — البرج 2"),
  onlyCompany: bi("Only your Company sees this Draft until it is Submitted.", "شركتك وحدها ترى هذه المسودة حتى تقديمها."),
  onlyYou: bi("Only you see this Draft until it is Submitted.", "أنت وحدك ترى هذه المسودة حتى تقديمها."),
  whoSees: bi("Who sees this Draft", "من يرى هذه المسودة"),
  required: bi("Required before Send for Review", "مطلوب قبل الإرسال للمراجعة"),
  incomplete: bi("A Draft can be saved incomplete. You send it from the Work Item page.", "يمكن حفظ المسودة ناقصة. ترسلها من صفحة عنصر العمل."),
  workflow: bi("Workflow after you send", "سير العمل بعد الإرسال"),
  before: bi("Before you send", "قبل الإرسال"),
  documents: bi("Documents", "المستندات"),
  locked: bi("Save the Draft first, then add Documents.", "احفظ المسودة أولًا، ثم أضف المستندات."),
  add: bi("Add", "إضافة"),
  notSaved: bi("Not saved yet", "لم يُحفظ بعد"),
  cancel: bi("Cancel", "إلغاء"),
  saveDraft: bi("Save Draft", "حفظ المسودة"),
  openPage: bi("Open Work Item page", "فتح صفحة عنصر العمل"),
  toast: bi("Draft saved — still “No number yet”", "حُفظت المسودة — ما زالت «بلا رقم بعد»"),
  discardTitle: bi("Discard this Draft?", "تجاهل هذه المسودة؟"),
  discardBody: bi("Nothing has been saved.", "لم يُحفظ شيء."),
  discard: bi("Discard", "تجاهل"),
  keep: bi("Keep editing", "متابعة التحرير"),
  notifications: bi("Notifications", "الإشعارات"),
  dismiss: bi("Dismiss", "إغلاق"),
};

const roles: Record<BaseRole, Bi> = {
  contractor: bi("Contractor", "المقاول"),
  consultant: bi("Consultant", "الاستشاري"),
  owner: bi("Owner", "المالك"),
  owner_representative: bi("Owner's Representative", "ممثل المالك"),
};

const routeLabels = (locale: Locale): NewItemRoutePreviewLabels => ({
  role: (role) => roles[role][locale],
  route: copy.workflow[locale],
  now: bi("Now · you", "الآن · أنت")[locale],
  review: (role) => (locale === "ar" ? `مراجعة ${roles[role].ar}` : `${roles[role].en} review`),
  private: bi("Steps inside are private", "الخطوات الداخلية خاصة")[locale],
  outcome: bi("Close or Revise", "إغلاق أو مراجعة")[locale],
});

const sizeLabels = (locale: Locale): SubmittalPanelSizeLabels => ({
  group: locale === "ar" ? "الحجم" : "Size",
  sizes: locale === "ar" ? { compact: "مضغوط", normal: "عادي", wide: "عريض", full: "كامل" } : { compact: "Compact", normal: "Normal", wide: "Wide", full: "Full" },
  grip: locale === "ar" ? "اسحب لتغيير الحجم" : "Drag to resize",
});

const draftRoute = submittalRoute({ definition: submittalOwnerWorkflow, stages: workflowStages, position: { kind: "own", stepKey: "draft" } });

function CreatePanel({
  context,
  width,
  layout = "slide-over",
  savedAt: initialSave = null,
  rail: railOn = true,
}: {
  context: StoryContext;
  width: number;
  layout?: SubmittalPanelLayout;
  savedAt?: string | null;
  /** Off (row 13): no side band at Wide and Full; "Before you send" stays in the flow. */
  rail?: boolean;
}) {
  const locale = storyLocale(context);
  const toast = useToast();
  const ids = useSubmittalPanelIds();
  const size = useSubmittalPanelSize({ initial: width, dir: locale === "ar" ? "rtl" : "ltr" });
  const [open, setOpen] = useState(true);
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("MAR");
  const [savedAt, setSavedAt] = useState<string | null>(initialSave);
  const [discarding, setDiscarding] = useState(false);
  const [folded, setFolded] = useState(false);
  const items = [
    { key: "subject", label: copy.subject[locale], done: subject.trim() !== "" },
    { key: "trade", label: bi("Trade", "التخصص")[locale], done: false },
    { key: "approved_supplier", label: bi("Approved supplier", "المورد المعتمد")[locale], done: false },
    { key: "location", label: bi("Location", "الموقع")[locale], done: false },
  ];
  const checklist = (incomplete: boolean) => <RequiredChecklist locale={locale} heading={copy.required[locale]} items={items} incomplete={incomplete ? copy.incomplete[locale] : undefined} />;
  const route = <NewItemRoutePreview locale={locale} route={draftRoute} labels={routeLabels(locale)} heading={copy.workflow[locale]} />;
  const close = () => (savedAt === null && subject !== "" ? setDiscarding(true) : setOpen(false));
  if (!open) return <Button onClick={() => setOpen(true)}>{copy.crumb[locale]}</Button>;
  return (
    <>
      <SubmittalPanel
        locale={locale}
        labels={{ module: copy.module[locale], position: (n, t) => `${n} / ${t}`, previous: "", next: "", close: copy.close[locale], hint: "", back: copy.back[locale] }}
        mode="create"
        layout={layout}
        crumb={copy.crumb[locale]}
        labelledBy={ids.numberId}
        onClose={close}
        width={size.width}
        resizing={size.resizing}
        edge={<SubmittalPanelGrip size={size} locale={locale} labels={sizeLabels(locale)} />}
        topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels(locale)} />}
        identity={
          <NewItemIdentity
            locale={locale}
            noNumber={copy.noNumber[locale]}
            draft={copy.draft[locale]}
            subject={subject}
            onSubjectChange={setSubject}
            subjectLabel={copy.subject[locale]}
            placeholder={copy.placeholder[locale]}
            numberId={ids.numberId}
          >
            <NewItemTypeCards
              locale={locale}
              heading={copy.types[locale]}
              types={[{ code: "MAR", name: bi("Material Approval Request", "طلب اعتماد مواد"), description: bi("The only Type this Project uses", "النوع الوحيد في هذا المشروع") }]}
              value={type}
              onChange={setType}
            />
            <DraftWhoSees look="banner" draftsVisibleTo="company" companyName="TMC Constructions" labels={{ author: copy.onlyYou[locale], company: copy.onlyCompany[locale] }} />
          </NewItemIdentity>
        }
        rail={
          railOn && (
          <>
            {checklist(true)}
            {route}
            <DraftWhoSees
              look="box"
              draftsVisibleTo="company"
              companyName={bi("TMC Constructions", "تي إم سي للمقاولات")[locale]}
              labels={{ author: copy.onlyYou[locale], company: copy.onlyCompany[locale], heading: copy.whoSees[locale] }}
            />
          </>
          )
        }
        actions={
          <NewItemFooter
            layout={layout === "page" ? "page" : "slide-over"}
            savedAt={savedAt}
            openHref="#/work-items/42"
            onCancel={close}
            onSave={() => {
              if (savedAt === null) toast({ title: copy.toast[locale], tone: "success" });
              setSavedAt("10:42");
            }}
            labels={{ notSaved: copy.notSaved[locale], saved: (time) => (locale === "ar" ? `حُفظ ${time}` : `Saved ${time}`), cancel: copy.cancel[locale], saveDraft: copy.saveDraft[locale], openPage: copy.openPage[locale] }}
          />
        }
      >
        <NewItemSectionBar
          locale={locale}
          sections={5}
          required={newItemRequired(items)}
          labels={{
            summary: (s, d, t) => (locale === "ar" ? `${s} أقسام نموذج · ${d}/${t} من المطلوب مكتمل` : `${s} Form Sections · ${d}/${t} required filled`),
            collapseAll: bi("Collapse all", "طي الكل")[locale],
            expandAll: bi("Expand all", "توسيع الكل")[locale],
          }}
          allCollapsed={folded}
          onToggleAll={() => setFolded(!folded)}
        />
        <div className="flex flex-col gap-2 px-5 @[880px]/sdp:px-7">
          <BeforeYouSend heading={copy.before[locale]} checklist={checklist(false)} route={route} inflow={railOn} />
          {!folded && savedAt === null && (
            <section aria-label={copy.documents[locale]} className="rounded-[12px] p-4 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
              <LockedDocuments
                labels={{ locked: copy.locked[locale], add: copy.add[locale] }}
                slots={[
                  { key: "datasheet", label: bi("Datasheet (PDF)", "ورقة البيانات (PDF)")[locale], hint: bi("PDF or image", "PDF أو صورة")[locale] },
                  { key: "photo", label: bi("Sample photo", "صورة العينة")[locale], hint: bi("Time and place are read from the photo", "يُقرأ الوقت والمكان من الصورة")[locale], icon: "photo" },
                ]}
              />
            </section>
          )}
        </div>
      </SubmittalPanel>
      <DiscardDraftDialog
        open={discarding}
        onOpenChange={setDiscarding}
        onDiscard={() => setOpen(false)}
        labels={{ title: copy.discardTitle[locale], description: copy.discardBody[locale], discard: copy.discard[locale], keep: copy.keep[locale], close: copy.close[locale] }}
      />
    </>
  );
}

const meta = {
  title: "Views/Submittal Panel/New item panel",
  parameters: overlay,
  decorators: [
    (Story, context) => (
      <ToastProvider label={storyText(context, copy.notifications)} closeLabel={storyText(context, copy.dismiss)} placement="center" look="dark">
        <Story />
      </ToastProvider>
    ),
  ],
  render: (_args, context) => <CreatePanel context={context} width={960} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const visible = (element: Element | null) => element !== null && getComputedStyle(element).display !== "none";

/**
 * Wide (screenshot 1): the identity, Type card and banner in the main column; the checklist, the
 * route and "Who sees this Draft" in the rail; "Before you send" hidden, as the rail shows it.
 * The panel names no other Company and no person.
 */
export const Wide: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await expect(panel).toHaveAccessibleName(storyText(context, copy.noNumber));
    await expect(visible(panel.querySelector(".sdp-rail"))).toBe(true);
    await expect(visible(panel.querySelector("[data-before-you-send]"))).toBe(false);
    await expect(within(panel.querySelector<HTMLElement>(".sdp-rail")!).getByRole("list", { name: storyText(context, copy.required) })).toBeVisible();
    await expect(panel).not.toHaveTextContent(/Design Consultants|Hafiz|Ali Sonour|Material Submittal/);
    await expect(panel.querySelector(".sdp-body")!.scrollWidth).toBeLessThanOrEqual(panel.querySelector(".sdp-body")!.clientWidth);
  },
};

/** Normal (screenshot 19): no rail; "Before you send" in the flow above the Form Sections. */
export const Normal: Story = {
  render: (_args, context) => <CreatePanel context={context} width={640} />,
  play: async (context) => {
    const panel = panelOf(context);
    await expect(visible(panel.querySelector(".sdp-rail"))).toBe(false);
    await expect(visible(panel.querySelector("[data-before-you-send]"))).toBe(true);
    await expect(within(panel).getByRole("button", { name: storyText(context, copy.before) })).toHaveAttribute("aria-expanded", "true");
  },
};

/** "Collapse all" folds the Form Sections only: "Before you send" is a panel block and opens and closes on its own (row 12). */
export const CollapseAllLeavesBeforeYouSend: Story = {
  render: (_args, context) => <CreatePanel context={context} width={640} />,
  play: async (context) => {
    const panel = panelOf(context);
    const before = within(panel).getByRole("button", { name: storyText(context, copy.before) });
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, bi("Collapse all", "طي الكل")) }));
    await expect(before).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(before);
    await expect(before).toHaveAttribute("aria-expanded", "false");
    await expect(within(panel).getByRole("button", { name: storyText(context, bi("Expand all", "توسيع الكل")) })).toBeVisible();
  },
};

/** Rail off (row 13, RP-1221 and RP-1222): at Wide there is no side band, and "Before you send" stays in the flow. */
export const RailOff: Story = {
  render: (_args, context) => <CreatePanel context={context} width={960} rail={false} />,
  play: async (context) => {
    const panel = panelOf(context);
    await expect(panel.querySelector(".sdp-rail")).toBeNull();
    await expect(visible(panel.querySelector("[data-before-you-send]"))).toBe(true);
  },
};

/** Save Draft (rows 38, 39): the toast, "Saved 10:42", the Work Item page link; Documents unlock; the panel stays open. */
export const SavedWithToast: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await userEvent.type(within(panel).getByRole("textbox", { name: storyText(context, copy.subject) }), "LED");
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.saveDraft) }));
    await within(document.body).findByText(storyText(context, copy.toast));
    await expect(panelOf(context)).toBe(panel);
    await expect(within(panel).getByRole("link", { name: storyText(context, copy.openPage) })).toBeVisible();
    await expect(within(panel).queryByText(storyText(context, copy.locked))).toBeNull();
  },
};

/** Cancel after typing, before the first save (row 37): it asks first; Keep editing keeps the panel. */
export const CancelAsks: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await userEvent.type(within(panel).getByRole("textbox", { name: storyText(context, copy.subject) }), "LED");
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.cancel) }));
    const dialog = await within(document.body).findByRole("alertdialog", { name: storyText(context, copy.discardTitle) });
    await userEvent.click(within(dialog).getByRole("button", { name: storyText(context, copy.keep) }));
    await waitFor(() => expect(within(document.body).queryByRole("alertdialog")).toBeNull());
    await expect(panelOf(context)).toBe(panel);
  },
};

/** The phone's page after a save (screenshot 15): a back arrow, no size switch, "Before you send" in the flow, the footer's link an icon. */
export const PhoneSaved: Story = {
  parameters: { phone: true },
  render: (_args, context) => <CreatePanel context={context} width={640} layout="page" savedAt="10:42" />,
  play: async (context) => {
    const panel = panelOf(context);
    await expect(within(panel).getByRole("button", { name: storyText(context, copy.back) })).toBeVisible();
    await expect(visible(panel.querySelector("[data-before-you-send]"))).toBe(true);
    await expect(within(panel).getByRole("link", { name: storyText(context, copy.openPage) })).not.toHaveTextContent(storyText(context, copy.openPage));
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    // The List behind the phone's page doesn't scroll while it is open (row 7); closing gives the scroll back.
    const before = document.body.style.overflow;
    await expect(getComputedStyle(document.body).overflow).toBe("hidden");
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.back) }));
    await waitFor(() => expect(within(context.canvasElement).queryByRole("dialog")).toBeNull());
    await expect(document.body.style.overflow).not.toBe("hidden");
    await expect(before).toBe("hidden");
  },
};
