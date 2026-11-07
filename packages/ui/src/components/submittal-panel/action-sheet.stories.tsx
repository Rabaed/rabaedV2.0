import type { Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { CodeTile } from "../work-item-page/page-parts.tsx";
import { ActionSheetEffects, ActionSheetSigner, type ActionSheetEffectsLabels } from "./action-sheet.tsx";
import { actionSheetEffects } from "./action-sheet-model.ts";
import { SubmittalPanel } from "./submittal-panel.tsx";

/*
 * The Submittal Panel's Action Form sheet parts (RP-1237, gap table v3 rows 29, 30 and 39; the owner's
 * Anatomy V3 frames 11–13): "What happens when you confirm", from the Workflow map the viewer reads, and
 * "Signs as ‹name› · ‹role›" beside the buttons. Shown in a sheet from the panel's bottom, at Normal and at
 * Full (the item's page). Story data only.
 */

const bi = (en: string, ar: string) => ({ en, ar });
const copy = {
  title: bi("What happens when you confirm", "ما يحدث عند التأكيد"),
  signsAs: bi("Signs as", "يوقّع باسم"),
  cancel: bi("Cancel", "إلغاء"),
  issue: bi("Issue Code B", "إصدار الرمز B"),
  heading: bi("Code B · Approved as noted", "الرمز B · معتمد مع ملاحظات"),
};
const tmc = bi("TMC Constructions", "تي إم سي للمقاولات");
const definition = {
  steps: [
    { key: "review", name: bi("Review", "المراجعة"), stage: "pending" },
    { key: "noted", name: bi("Approved as noted", "معتمد مع ملاحظات"), stage: "noted" },
  ],
  transitions: [{ key: "approve_b", kind: "close", from: "review", to: "noted", outcome: "B" }],
} as never;
const stages = [{ key: "noted", name: bi("Approved as Noted", "معتمد مع ملاحظات") }];

const labels = (locale: Locale): ActionSheetEffectsLabels =>
  locale === "ar"
    ? {
        title: copy.title.ar,
        stage: (s) => `تصبح المرحلة ${s}`,
        told: (c) => `يُبلَّغ ${c}`,
        comments: (n, c) => `${n} ملاحظات مفتوحة في قائمة الملاحظات${c ? ` لـ ${c}` : ""}`,
        revision: (c) => `يعود${c ? ` إلى ${c}` : ""} لمراجعة جديدة`,
        record: (code) => `يُطبع الرمز ${code} على السجل المستندي`,
      }
    : {
        title: copy.title.en,
        stage: (s) => `Stage becomes ${s}`,
        told: (c) => `${c} is told`,
        comments: (n, c) => `${n} Comments open in the Snag List${c ? ` for ${c}` : ""}`,
        revision: (c) => `Back${c ? ` to ${c}` : ""} for a new Revision`,
        record: (code) => `Code ${code} is printed on the Documental Record`,
      };

function SheetDemo({ context, width }: { context: StoryContext; width: number }) {
  const locale = storyLocale(context);
  const effects = actionSheetEffects({ transitionKey: "approve_b", definition, stages, goesTo: tmc, code: "B", offersRevision: false, comments: 2 });
  return (
    <SubmittalPanel
      locale={locale}
      labels={{ module: "Submittals", position: (n, t) => `${n} / ${t}`, previous: "Previous", next: "Next", close: copy.cancel[locale], hint: "Esc" }}
      crumb={<DocNo value="TWR-TMC-EL-MAR-280" />}
      onClose={() => undefined}
      width={width}
      label="TWR-TMC-EL-MAR-280"
    >
      <div role="dialog" aria-label={copy.heading[locale]} data-sheet="" className="absolute inset-x-0 bottom-0 flex max-h-[85%] flex-col rounded-t-[18px] bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
          <CodeTile code="B" look="b" size="lg" />
          <h2 className="text-[16px] font-bold">{copy.heading[locale]}</h2>
        </div>
        <div className="px-5 py-4">
          <ActionSheetEffects effects={effects} labels={labels(locale)} locale={locale} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-5 py-3">
          <ActionSheetSigner name={bi("Mohammed Al Shamsi", "محمد الشامسي")} position={locale === "ar" ? "مدير الاستشاري" : "Consultant Manager"} signsAs={copy.signsAs[locale]} locale={locale} />
          <Button variant="secondary">{copy.cancel[locale]}</Button>
          <Button>{copy.issue[locale]}</Button>
        </div>
      </div>
    </SubmittalPanel>
  );
}

const meta = {
  title: "Views/Submittal Panel/Action Form sheet",
  parameters: overlay,
  render: (_args, context) => <SheetDemo context={context} width={640} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const sheetOf = (context: PlayContext) => context.canvasElement.ownerDocument.querySelector<HTMLElement>("[data-sheet]")!;

async function checkSheet(context: PlayContext) {
  const sheet = sheetOf(context);
  const effects = within(sheet).getByRole("region", { name: storyText(context, copy.title) });
  const items = within(effects).getAllByRole("listitem");
  // The Stage it moves to, the Comments its rows open and for whom, and the Code on the Documental Record; no date, no "stamp".
  await expect(items).toHaveLength(3);
  await expect(items[1]).toHaveTextContent(storyText(context, bi("2 Comments open in the Snag List for TMC Constructions", "2 ملاحظات مفتوحة في قائمة الملاحظات لـ تي إم سي للمقاولات")));
  await expect(effects).not.toHaveTextContent(/stamp|due|deadline|ختم/i);
  await expect(sheet.querySelector("[data-sheet-signer]")).toHaveTextContent(storyText(context, bi("Signs as Mohammed Al Shamsi · Consultant Manager", "يوقّع باسم محمد الشامسي · مدير الاستشاري")));
  // The sheet sits at the panel's bottom, its whole width.
  const panel = context.canvasElement.ownerDocument.querySelector<HTMLElement>("[data-submittal-panel]")!.getBoundingClientRect();
  const box = sheet.getBoundingClientRect();
  await expect(Math.round(box.bottom)).toBe(Math.round(panel.bottom));
  // Inside the panel's 1px edge.
  await expect(Math.round(panel.width - box.width)).toBeLessThanOrEqual(1);
}

/** At Normal (row 29): from the panel's bottom, inside the panel. */
export const AtNormal: Story = { play: checkSheet };

/** At Full, the item's page: the same sheet. */
export const AtFull: Story = { render: (_args, context) => <SheetDemo context={context} width={1400} />, play: checkSheet };
