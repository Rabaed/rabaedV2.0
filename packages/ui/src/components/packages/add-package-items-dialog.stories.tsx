import type { WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone, tablet } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { packagePageLabels } from "../../storybook/packages.ts";
import { touchTargetOffenders } from "../../storybook/touch-target.ts";
import { AddPackageItemsDialog, type PackageItemSearch } from "./add-package-items-dialog.tsx";

// The "+ Add submittals" pop-up's rows with a long Trade name (RP-1311, under the responsive spec
// RP-1158). On a phone (402) the Trade takes its own line under the Subject and Document Number, and
// the stage pill stays at the row's end, as the Packages view's cards do; at 820 and wider the Trade
// stays beside the Document Number, as before. Never cut with an ellipsis. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const labelsOf = (context: { globals: Record<string, unknown> }) => packagePageLabels[storyLocale(context)];

const ownCompany = b("Al Futtaim Contracting", "شركة الفطيم للمقاولات");
const mep = { id: "00000000-0000-4000-8000-0000000000e3", code: "MEP", name: b("Mechanical, Electrical and Plumbing", "الأعمال الميكانيكية والكهربائية والسباكة") };
const mar = { code: "MAR", name: b("Material Approval Request", "طلب اعتماد مواد") };
const pkgId = "00000000-0000-4000-8000-0000000000f1";

const row = (n: number, title: string, rest: Partial<WorkItemRow> = {}): WorkItemRow => ({
  id: `00000000-0000-4000-8000-0000000000${n}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: mar,
  title,
  documentNumber: `TWR-MAR-AFC-00${n}`,
  revisionNo: 0,
  stage: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" },
  trade: mep,
  location: null,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  submissionDate: "2026-09-01T09:00:00.000Z",
  creationDate: "2026-09-01T09:00:00.000Z",
  with: { kind: "company", companyName: b("Design Consultants", "المستشارون للتصميم") },
  raiserCompanyName: ownCompany,
  ...rest,
});

const inOtherPackage = { package: { id: "00000000-0000-4000-8000-0000000000f2", number: "PKG-002", name: b("Fire fighting", "مكافحة الحريق"), companyName: ownCompany } };

const found: WorkItemRow[] = [
  // Submitted, so it has its Document Number, at a long stage.
  row(31, "Chilled water pumps"),
  // A Draft: its number comes on Submit.
  row(32, "Booster pump set", {
    documentNumber: null,
    stage: { key: "draft", name: b("Draft", "مسودة"), category: "draft" },
    stepEnteredAt: null,
    stepAgeWeeks: null,
    submissionDate: null,
    creationDate: null,
  }),
  // Already in another Package: marked, and can't be picked.
  row(33, "Fire sprinkler heads", inOtherPackage),
];
const search: PackageItemSearch = async () => found;

// Long Subjects (RP-1317): one Submitted, one already in another Package, in the story's language.
const longSubjects = {
  en: [
    row(34, "Chilled water pumps for the podium plant room, with variable speed drives, vibration isolators and flexible connectors"),
    row(35, "Fire sprinkler heads and pipework for the basement car park levels B1 to B3, with the zone control valves", inOtherPackage),
  ],
  ar: [
    row(34, "مضخات المياه المبردة لغرفة المعدات في المنصة مع محركات متغيرة السرعة وعوازل الاهتزاز والوصلات المرنة"),
    row(35, "رشاشات الحريق وأنابيبها لمواقف السيارات في الأقبية من الأول إلى الثالث مع صمامات التحكم بالمناطق", inOtherPackage),
  ],
};
const longSubjectSearch: Record<keyof typeof longSubjects, PackageItemSearch> = { en: async () => longSubjects.en, ar: async () => longSubjects.ar };

const meta = {
  title: "Packages/AddPackageItemsDialog",
  component: AddPackageItemsDialog,
  args: {
    packageId: pkgId,
    trades: [mep],
    locale: "en",
    labels: packagePageLabels.en.addItems,
    close: packagePageLabels.en.close,
    cancel: packagePageLabels.en.cancel,
    refusals: packagePageLabels.en.refusals,
    search: fn(search),
    onAdd: fn(async () => ({ ok: true as const })),
  },
  render: (args, context) => {
    const l = labelsOf(context);
    return <AddPackageItemsDialog {...args} locale={storyLocale(context)} labels={l.addItems} close={l.close} cancel={l.cancel} refusals={l.refusals} />;
  },
} satisfies Meta<typeof AddPackageItemsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

type Context = Parameters<NonNullable<Story["play"]>>[0];

/** The part of `li` that holds `element`: one of the row's three parts (checkbox, text, pill). */
const partOf = (li: HTMLElement, element: HTMLElement) => [...li.children].find((part) => part.contains(element)) as HTMLElement;

/**
 * Opens the pop-up and waits for its rows: each row's checkbox, its text (the checkbox's label), the Trade, the
 * Type's code and the pill at the row's end (its stage, or "In PKG-002" for one in another Package).
 */
async function openRows(context: Context, shown: WorkItemRow[] = found) {
  const l = labelsOf(context);
  const locale = storyLocale(context);
  await userEvent.click(context.canvas.getByRole("button", { name: l.addItems.trigger }));
  const dialog = await screen.findByRole("dialog", { name: l.addItems.title });
  const results = await within(dialog).findByRole("list", { name: l.addItems.results });
  const items = within(results).getAllByRole("listitem");
  await expect(items).toHaveLength(shown.length);
  const rows = items.map((li, i) => {
    const item = shown[i]!;
    const checkbox = within(li).getByRole("checkbox", { name: l.addItems.choose(item.title) });
    const text = (checkbox as HTMLButtonElement).labels[0]!;
    const trade = within(li).getByText(mep.name[locale]);
    // The Type's code, on the line with the Document Number (or "Number on submit").
    const code = within(li).getByText(mar.code);
    const pill = partOf(li, within(li).getByText(item.package ? l.addItems.inOther(item.package.number) : item.stage.name[locale]));
    const subject = within(li).getByText(item.title);
    return { li, checkbox, text, subject, trade, code, pill };
  });
  return { dialog, results, rows };
}

/** Every part of the row's text (Subject, number, Type, Trade) stays inside its own column: none runs under the pill, or past the row. */
async function expectTextBesideThePill({ text, pill }: { text: HTMLElement; pill: HTMLElement }) {
  const column = text.getBoundingClientRect();
  const end = pill.getBoundingClientRect();
  // Element boxes, not text ranges: the Subject's clipped tail (cut with an ellipsis, as before) is not on screen.
  for (const part of text.querySelectorAll("*")) {
    const box = part.getBoundingClientRect();
    await expect({ part: part.textContent, left: box.left >= column.left - 0.5, right: box.right <= column.right + 0.5 }).toEqual({ part: part.textContent, left: true, right: true });
  }
  // The text's column and the pill share no screen width.
  await expect(column.right <= end.left + 0.5 || end.right <= column.left + 0.5).toBe(true);
}

/** Nothing scrolls sideways: not the page, the pop-up, nor its list. */
async function expectNoSidewaysScroll(dialog: HTMLElement, results: HTMLElement) {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await expect(results.scrollWidth).toBeLessThanOrEqual(results.clientWidth);
}

/** In reading order: the checkbox, then the text, then the pill at the row's end (mirrored in Arabic). */
async function expectInReadingOrder(context: Context, { checkbox, text, pill }: { checkbox: HTMLElement; text: HTMLElement; pill: HTMLElement }) {
  const [c, t, e] = [checkbox, text, pill].map((el) => el.getBoundingClientRect());
  if (storyLocale(context) === "ar") {
    await expect(c!.left).toBeGreaterThanOrEqual(t!.right - 0.5);
    await expect(t!.left).toBeGreaterThanOrEqual(e!.right - 0.5);
  } else {
    await expect(c!.right).toBeLessThanOrEqual(t!.left + 0.5);
    await expect(t!.right).toBeLessThanOrEqual(e!.left + 0.5);
  }
}

/**
 * On a phone (402), a long Trade ("Mechanical, Electrical and Plumbing"): it takes its own line under the
 * Subject and Document Number, never cut short, and the stage pill (or "In PKG-002") stays at the row's end,
 * with no text under it and nothing scrolling sideways. Document Numbers stay left to right; Arabic is
 * mirrored. Each row's checkbox is a full touch target. Left open for the screenshot.
 */
export const LongTradeOnAPhone: Story = {
  parameters: { ...phone, ...overlay },
  play: async (context) => {
    const { dialog, results, rows } = await openRows(context);
    for (const r of rows) {
      // Its own line, under the number's.
      await expect(r.trade.getBoundingClientRect().top).toBeGreaterThanOrEqual(r.code.getBoundingClientRect().bottom - 0.5);
      // Whole: no ellipsis.
      await expect(r.trade.scrollWidth).toBeLessThanOrEqual(r.trade.clientWidth);
      // The checkbox and the pill line up with the Subject, the row's first line, as a card's first line.
      const subject = r.subject.getBoundingClientRect();
      for (const side of [r.checkbox, r.pill]) {
        const box = side.getBoundingClientRect();
        await expect(box.top).toBeLessThan(subject.bottom);
        await expect(box.bottom).toBeGreaterThan(subject.top);
        await expect(box.top).toBeLessThan(r.code.getBoundingClientRect().top);
      }
      await expectTextBesideThePill(r);
      await expectInReadingOrder(context, r);
    }
    for (const docNo of results.querySelectorAll("bdi")) await expectLaidOutLeftToRight(docNo);
    await expectNoSidewaysScroll(dialog, results);
    await expect(touchTargetOffenders(results)).toEqual([]);
  },
};

/** At 820, the same rows as before RP-1311: the Trade on the Document Number's line, the pill at the row's end. */
export const LongTradeOnATablet: Story = {
  parameters: { ...tablet, ...overlay },
  play: async (context) => {
    const { dialog, results, rows } = await openRows(context);
    for (const r of rows) {
      const trade = r.trade.getBoundingClientRect();
      const code = r.code.getBoundingClientRect();
      // On one line with the number and the Type's code.
      await expect(Math.abs(trade.top + trade.height / 2 - (code.top + code.height / 2))).toBeLessThan(2);
      await expectTextBesideThePill(r);
      await expectInReadingOrder(context, r);
    }
    await expectNoSidewaysScroll(dialog, results);
  },
};

/** The long Subjects' rows, in the story's language. */
const withLongSubjects: Story["render"] = (args, context) => {
  const l = labelsOf(context);
  const locale = storyLocale(context);
  return <AddPackageItemsDialog {...args} search={longSubjectSearch[locale]} locale={locale} labels={l.addItems} close={l.close} cancel={l.cancel} refusals={l.refusals} />;
};

/** How many lines `element`'s box holds. */
const linesOf = (element: HTMLElement) => Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight));

/**
 * On a phone (402), a long Subject (RP-1317, the owner's answer (a)): two lines, then an ellipsis, so similar
 * submittals can be told apart. The whole Subject stays in the page for screen readers, and in the checkbox's
 * name. The Trade keeps its own line under the number (RP-1311), the pill stays at the row's end, nothing runs
 * under it or scrolls sideways, and each checkbox is a full touch target. Left open for the screenshot.
 */
export const LongSubjectOnAPhone: Story = {
  parameters: { ...phone, ...overlay },
  render: withLongSubjects,
  play: async (context) => {
    const shown = longSubjects[storyLocale(context)];
    const { dialog, results, rows } = await openRows(context, shown);
    for (const [i, r] of rows.entries()) {
      // Two lines, then cut: no more.
      await expect(linesOf(r.subject)).toBe(2);
      await expect(r.subject.scrollHeight).toBeGreaterThan(r.subject.clientHeight);
      // Cut on screen only: the whole Subject is still there for screen readers.
      await expect(r.subject.textContent).toBe(shown[i]!.title);
      // The number's line and the Trade's line come under the Subject's two lines, not over them.
      const subject = r.subject.getBoundingClientRect();
      await expect(r.code.getBoundingClientRect().top).toBeGreaterThanOrEqual(subject.bottom - 0.5);
      await expect(r.trade.getBoundingClientRect().top).toBeGreaterThanOrEqual(r.code.getBoundingClientRect().bottom - 0.5);
      // The pill lines up with the Subject's first line.
      const pill = r.pill.getBoundingClientRect();
      await expect(pill.top).toBeLessThan(subject.top + subject.height / 2);
      await expectTextBesideThePill(r);
      await expectInReadingOrder(context, r);
    }
    for (const docNo of results.querySelectorAll("bdi")) await expectLaidOutLeftToRight(docNo);
    await expectNoSidewaysScroll(dialog, results);
    await expect(touchTargetOffenders(results)).toEqual([]);
  },
};

/** At 820, unchanged: a long Subject keeps its one line, cut with an ellipsis, as before RP-1317. */
export const LongSubjectOnATablet: Story = {
  parameters: { ...tablet, ...overlay },
  render: withLongSubjects,
  play: async (context) => {
    const shown = longSubjects[storyLocale(context)];
    const { dialog, results, rows } = await openRows(context, shown);
    for (const r of rows) {
      await expect(linesOf(r.subject)).toBe(1);
      await expect(r.subject.scrollWidth).toBeGreaterThan(r.subject.clientWidth);
      await expectTextBesideThePill(r);
      await expectInReadingOrder(context, r);
    }
    await expectNoSidewaysScroll(dialog, results);
  },
};
