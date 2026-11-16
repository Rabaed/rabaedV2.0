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
// RP-1158). On a phone (402) the Trade takes its own line under the Document Number and title, and
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
  row(33, "Fire sprinkler heads", { package: { id: "00000000-0000-4000-8000-0000000000f2", number: "PKG-002", name: b("Fire fighting", "مكافحة الحريق"), companyName: ownCompany } }),
];
const search: PackageItemSearch = async () => found;

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

/** Opens the pop-up and waits for its rows: each row's checkbox, its text, the Trade, its number line and its end (the stage pill, or "In PKG-002"). */
async function openRows(context: Context) {
  const l = labelsOf(context);
  const locale = storyLocale(context);
  await userEvent.click(context.canvas.getByRole("button", { name: l.addItems.trigger }));
  const dialog = await screen.findByRole("dialog", { name: l.addItems.title });
  const results = await within(dialog).findByRole("list", { name: l.addItems.results });
  const rows = within(results)
    .getAllByRole("listitem")
    .map((li) => {
      const checkbox = within(li).getByRole("checkbox");
      const text = li.querySelector("label")!;
      const trade = within(li).getByText(mep.name[locale]);
      const end = text.nextElementSibling as HTMLElement;
      // The Type's code, on the line with the Document Number (or "Number on submit").
      const code = within(li).getByText(mar.code);
      return { li, checkbox, text, trade, end, code };
    });
  await expect(rows).toHaveLength(found.length);
  return { dialog, results, rows };
}

/** Every part of the row's text (title, number, Type, Trade) stays inside its own column: none runs under the pill, or past the row. */
async function expectTextBesideTheEnd({ text, end }: { text: HTMLElement; end: HTMLElement }) {
  const column = text.getBoundingClientRect();
  const pill = end.getBoundingClientRect();
  // Element boxes, not text ranges: the title's clipped tail (cut with an ellipsis, as before) is not on screen.
  for (const part of text.querySelectorAll("*")) {
    const box = part.getBoundingClientRect();
    await expect({ part: part.textContent, left: box.left >= column.left - 0.5, right: box.right <= column.right + 0.5 }).toEqual({ part: part.textContent, left: true, right: true });
  }
  // The text's column and the pill share no screen width.
  await expect(column.right <= pill.left + 0.5 || pill.right <= column.left + 0.5).toBe(true);
}

/** Nothing scrolls sideways: not the page, the pop-up, nor its list. */
async function expectNoSidewaysScroll(dialog: HTMLElement, results: HTMLElement) {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await expect(results.scrollWidth).toBeLessThanOrEqual(results.clientWidth);
}

/** In reading order: the checkbox, then the text, then the pill at the row's end (mirrored in Arabic). */
async function expectInReadingOrder(context: Context, { checkbox, text, end }: { checkbox: HTMLElement; text: HTMLElement; end: HTMLElement }) {
  const [c, t, e] = [checkbox, text, end].map((el) => el.getBoundingClientRect());
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
 * Document Number and title, never cut short, and the stage pill (or "In PKG-002") stays at the row's end,
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
      await expectTextBesideTheEnd(r);
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
      await expectTextBesideTheEnd(r);
      await expectInReadingOrder(context, r);
    }
    await expectNoSidewaysScroll(dialog, results);
  },
};
