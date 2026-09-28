import { formatDate, formatNumber } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect } from "storybook/test";
import { storyLocale, storyText } from "../storybook/locale.ts";

const meta = {
  title: "Foundations/Typography",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A fixed moment so the story and its screenshot never change: 28 Sep 2026, 12:05 in Riyadh.
const sample = new Date("2026-09-28T09:05:00Z");

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-baseline gap-4 border-b border-border-subtle py-2 last:border-b-0">
      <span className="text-caption text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}

function Typography(context: StoryContext) {
  const locale = storyLocale(context);
  const t = (en: string, ar: string) => storyText(context, { en, ar });
  return (
    <main className="space-y-6 bg-canvas p-6">
      <section className="rounded-md border border-border bg-surface p-4 shadow-xs">
        <h2 className="mb-2 font-display text-h6 font-semibold text-text">{t("Families", "الخطوط")}</h2>
        <Row label={t("Display", "العناوين")}>
          <span className="font-display text-h4 font-bold">{t("Riyadh Gate Tower", "برج بوابة الرياض")}</span>
        </Row>
        <Row label={t("Interface", "الواجهة")}>
          <span className="text-lg">{t("Shop drawings for level 12 are with the Consultant.", "المخططات التنفيذية للطابق 12 لدى الاستشاري.")}</span>
        </Row>
        <Row label={t("Weights", "الأوزان")}>
          <span className="flex flex-wrap gap-4 text-lg">
            <span className="font-normal">{t("Regular", "عادي")}</span>
            <span className="font-medium">{t("Medium", "متوسط")}</span>
            <span className="font-semibold">{t("Semibold", "شبه عريض")}</span>
            <span className="font-bold">{t("Bold", "عريض")}</span>
          </span>
        </Row>
      </section>

      <section className="rounded-md border border-border bg-surface p-4 shadow-xs">
        <h2 className="mb-2 font-display text-h6 font-semibold text-text">{t("Numbers and dates", "الأرقام والتواريخ")}</h2>
        <Row label={t("Number", "رقم")}>
          <span data-testid="number">{formatNumber(1234567.5, locale)}</span>
        </Row>
        <Row label={t("Percent", "نسبة")}>
          <span data-testid="percent">{formatNumber(0.25, locale, { style: "percent" })}</span>
        </Row>
        <Row label={t("Date", "تاريخ")}>
          <span data-testid="date">{formatDate(sample, locale)}</span>
        </Row>
        <Row label={t("Time", "وقت")}>
          <span data-testid="time">{formatDate(sample, locale, { timeStyle: "short" })}</span>
        </Row>
      </section>
    </main>
  );
}

/** The first family in a font-family list, e.g. `'Thmanyah Sans'` from `'Thmanyah Sans', 'IBM Plex Sans Arabic'`. */
function firstFamily(stack: string) {
  return stack.split(",")[0]!.trim();
}

export const Specimen: Story = {
  render: (_args, context) => <Typography {...context} />,
  play: async ({ canvas }) => {
    // Every family is self-hosted and loads. Arabic is whichever font the build chose:
    // Thmanyah Sans when its private files were present, else IBM Plex Sans Arabic.
    const arabic = firstFamily(getComputedStyle(document.documentElement).getPropertyValue("--font-arabic"));
    await expect(["'Thmanyah Sans'", "'IBM Plex Sans Arabic'"]).toContain(arabic.replaceAll('"', "'"));
    for (const [family, sampleText] of [
      ["'IBM Plex Sans Variable'", "Riyadh"],
      ["'Montserrat Variable'", "Riyadh"],
      [arabic, "الرياض"],
    ] as const) {
      const faces = await document.fonts.load(`400 16px ${family}`, sampleText);
      await expect({ family, loaded: faces.filter((face) => face.status === "loaded").length > 0 }).toEqual({ family, loaded: true });
    }

    // Latin digits, Gregorian calendar, in both languages.
    await expect(canvas.getByTestId("date")).toHaveTextContent(/2026/);
    await expect(canvas.getByTestId("date")).toHaveTextContent(/28/);
    await expect(canvas.getByTestId("time")).toHaveTextContent(/12:05/);
    await expect(canvas.getByTestId("percent")).toHaveTextContent(/25/);
    await expect(canvas.getByTestId("number")).toHaveTextContent(/^1.234.567.5$/);
  },
};
