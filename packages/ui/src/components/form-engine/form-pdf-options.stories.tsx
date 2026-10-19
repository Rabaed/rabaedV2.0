import type { FormPdf } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { FormPdfOptions, type FormPdfOptionsLabels } from "./form-pdf-options.tsx";

// The Form builder's Documental Record panel (RP-650): the Disclaimer in both languages and the
// review duration choice of a Form Version's `pdf` block.

const copy = {
  title: { en: "Documental Record", ar: "السجل الموثّق" },
  intro: {
    en: "Every record made with this Form Version ends with its Disclaimer.",
    ar: "ينتهي كل سجل يُصدر بهذا الإصدار من النموذج بإخلاء المسؤولية الخاص به.",
  },
  disclaimerAr: { en: "Disclaimer (Arabic)", ar: "إخلاء المسؤولية (عربي)" },
  disclaimerEn: { en: "Disclaimer (English)", ar: "إخلاء المسؤولية (إنجليزي)" },
  disclaimerHelp: { en: "Starts from Rabaed's text; change it for your own Forms.", ar: "يبدأ من نص رابد، ويمكنك تعديله لنماذجك." },
  disclaimerBothLanguages: { en: "Write it in both languages, or leave both empty.", ar: "اكتبه باللغتين، أو اترك الاثنين فارغين." },
  reviewDuration: { en: "Show the review duration", ar: "إظهار مدة المراجعة" },
  reviewDurationHelp: {
    en: "The days from the Submission Date to the reply, printed for information.",
    ar: "عدد الأيام من تاريخ التقديم إلى تاريخ الرد، يُطبع للعلم فقط.",
  },
} satisfies Record<keyof FormPdfOptionsLabels, { en: string; ar: string }>;

const rabaedDefault: FormPdf = {
  disclaimer: {
    en: "This record was issued electronically through Rabaed and is valid without a handwritten signature.",
    ar: "صدر هذا السجل إلكترونيًا عبر رابد، وهو معتمد دون توقيع خطي.",
  },
  show_review_duration: false,
};

function Panel({ initial, labels, readOnly }: { initial: FormPdf; labels: FormPdfOptionsLabels; readOnly?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="max-w-xl">
      <FormPdfOptions value={value} onChange={setValue} labels={labels} readOnly={readOnly} />
      <output data-testid="value" className="sr-only">
        {JSON.stringify(value)}
      </output>
    </div>
  );
}

const meta = {
  title: "Form engine/Form PDF options",
  component: Panel,
  args: { initial: rabaedDefault, labels: {} as FormPdfOptionsLabels },
  render: (args, context) => {
    const labels = Object.fromEntries(Object.entries(copy).map(([k, t]) => [k, storyText(context, t)])) as FormPdfOptionsLabels;
    return <Panel {...args} labels={labels} />;
  },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const valueOf = (context: PlayContext): FormPdf => JSON.parse(context.canvas.getByTestId("value").textContent ?? "{}");

/** Rabaed's Default text, review duration off; the author edits the English and turns the duration on. */
export const Default: Story = {
  play: async (context) => {
    const english = context.canvas.getByRole("textbox", { name: storyText(context, copy.disclaimerEn) });
    await expect(english).toHaveValue(rabaedDefault.disclaimer!.en);
    await userEvent.type(english, " Keep it.");
    await expect(valueOf(context).disclaimer?.en).toBe(`${rabaedDefault.disclaimer!.en} Keep it.`);
    const duration = context.canvas.getByRole("switch", { name: storyText(context, copy.reviewDuration) });
    await expect(duration).toHaveAccessibleDescription(storyText(context, copy.reviewDurationHelp));
    await userEvent.click(duration);
    await expect(valueOf(context).show_review_duration).toBe(true);
  },
};

/** A Disclaimer in one language only is flagged on the empty one; both emptied leaves no Disclaimer. */
export const OneLanguageOnly: Story = {
  args: { initial: { disclaimer: { en: "English only", ar: "" } } },
  play: async (context) => {
    const arabic = context.canvas.getByRole("textbox", { name: storyText(context, copy.disclaimerAr) });
    await expect(arabic).toHaveAttribute("aria-invalid", "true");
    await expect(arabic).toHaveAccessibleDescription(expect.stringContaining(storyText(context, copy.disclaimerBothLanguages)));
    await userEvent.clear(context.canvas.getByRole("textbox", { name: storyText(context, copy.disclaimerEn) }));
    await expect(valueOf(context).disclaimer).toBeUndefined();
  },
};

/** A published Form Version: shown, not changed. */
export const Published: Story = {
  args: { initial: { ...rabaedDefault, show_review_duration: true }, readOnly: true },
  play: async (context) => {
    await expect(context.canvas.getByRole("textbox", { name: storyText(context, copy.disclaimerAr) })).toHaveAttribute("readonly");
    await expect(context.canvas.getByRole("switch", { name: storyText(context, copy.reviewDuration) })).toHaveAttribute("aria-readonly", "true");
  },
};
