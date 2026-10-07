import type { CounterPreview, CounterValues, Locale, NumberingCounter } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { numberingCountersLabels } from "../../storybook/numbering.ts";
import { NumberingCounters } from "./numbering-counters.tsx";

// Counters and starting numbers on Project Settings → Numbering (RP-315, spec
// RP-311). For Project Admins only (visibility.md scenario 55): the page renders
// it only when the API returned the counters. Story data only.
const pCcm = "00000000-0000-4000-8000-000000000301";
const p01 = "00000000-0000-4000-8000-000000000302";

const participants = (locale: Locale) => [
  { value: pCcm, label: locale === "en" ? "Contracting Co. (CCM)" : "شركة المقاولات (CCM)" },
  { value: p01, label: locale === "en" ? "Electro Works (01)" : "الأعمال الكهربائية (01)" },
];
const trades = (locale: Locale) => [{ value: "00000000-0000-4000-8000-000000000311", label: locale === "en" ? "Electrical" : "كهرباء" }];
const locations = (locale: Locale) => [{ value: "00000000-0000-4000-8000-000000000321", label: locale === "en" ? "Building A" : "المبنى أ" }];
const workItemTypes = [{ code: "MAR", name: { en: "Material Approval Request", ar: "طلب اعتماد مواد" } }];

const counters: NumberingCounter[] = [
  { counterKey: "TWR-MAR-01", lastValue: 212, startingNumber: null, issued: true },
  { counterKey: "TWR-MAR-CCM", lastValue: 143, startingNumber: 144, issued: false },
];

/** The API's answer for the chosen values: CCM's counter is unused, 01's has issued up to 212. */
async function preview(values: CounterValues) {
  if (!values.participantId) return { ok: false as const, reason: "participant_required" };
  const used = values.participantId === p01;
  const counter: CounterPreview = {
    counterKey: used ? "TWR-MAR-01" : "TWR-MAR-CCM",
    prefix: used ? "TWR-MAR-01" : "TWR-MAR-CCM",
    separator: "-",
    seqDigits: 4,
    lastValue: used ? 212 : 143,
    issued: used,
  };
  return { ok: true as const, value: counter };
}

const copy = {
  title: { en: "Counters", ar: "العدّادات" },
  startingNumber: { en: "Starting number", ar: "رقم البداية" },
  save: { en: "Set starting number", ar: "تحديد رقم البداية" },
  next: { en: "The next number will be", ar: "سيكون الرقم التالي" },
  saved: { en: "Starting number set. The next number will be", ar: "تم تحديد رقم البداية. سيكون الرقم التالي" },
  none: { en: "No counters yet. A counter starts with the first number it issues.", ar: "لا توجد عدّادات بعد. يبدأ العدّاد بأول رقم يُصدره." },
  used: {
    en: "This counter has already issued numbers, up to 212. Its starting number can't change.",
    ar: "أصدر هذا العدّاد أرقامًا بالفعل حتى 212. لا يمكن تغيير رقم بدايته.",
  },
  invalid: { en: "Enter a whole number from 1 to 9,999,999.", ar: "أدخل عددًا صحيحًا من 1 إلى 9,999,999." },
};

const meta: Meta<typeof NumberingCounters> = {
  title: "Numbering/NumberingCounters",
  component: NumberingCounters,
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
};

export default meta;
type Story = StoryObj<typeof NumberingCounters>;

const render =
  (options: { counters?: NumberingCounter[]; firstParticipant?: "ccm" | "01" } = {}): Story["render"] =>
  (args, context) => {
    const locale = storyLocale(context);
    const people = participants(locale);
    return (
      <NumberingCounters
        {...args}
        locale={locale}
        labels={numberingCountersLabels[locale]}
        counters={options.counters ?? counters}
        workItemTypes={workItemTypes}
        participants={options.firstParticipant === "01" ? [...people].reverse() : people}
        trades={trades(locale)}
        locations={locations(locale)}
        preview={preview}
      />
    );
  };

/**
 * The counters with their last number, and a starting number set for CCM's MAR
 * counter, which has issued nothing: set 144, and the example says the next
 * number is TWR-MAR-CCM-0144.
 */
export const SetStartingNumber: Story = {
  args: { onSetStart: fn(async () => ({ ok: true as const, value: { counterKey: "TWR-MAR-CCM", nextNumber: "TWR-MAR-CCM-0144" } })) },
  render: render(),
  play: async (context) => {
    const { canvas, args } = context;
    const table = canvas.getByRole("table", { name: storyText(context, copy.title) });
    await expect(within(table).getByText("TWR-MAR-01")).toHaveAttribute("dir", "ltr");
    await expect(within(table).getByText("212")).toBeVisible();

    const start = canvas.getByRole("textbox", { name: storyText(context, copy.startingNumber) });
    await userEvent.clear(start);
    await userEvent.type(start, "144");
    const example = canvas.getByTestId("numbering-counter-example");
    await waitFor(() => expect(within(example).getByText("TWR-MAR-CCM-0144")).toHaveAttribute("dir", "ltr"));
    await expect(example).toHaveTextContent(storyText(context, copy.next));

    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.save) }));
    await expect(args.onSetStart).toHaveBeenCalledWith({
      workItemType: "MAR",
      participantId: pCcm,
      tradeId: null,
      locationId: null,
      startingNumber: 144,
    });
    await expect(await canvas.findByRole("status")).toHaveTextContent(storyText(context, copy.saved));
  },
};

/** A counter that has issued numbers: its starting number is locked, and saving is not offered. */
export const Locked: Story = {
  args: { onSetStart: fn() },
  render: render({ firstParticipant: "01" }),
  play: async (context) => {
    const { canvas } = context;
    await expect(await canvas.findByText(storyText(context, copy.used))).toBeVisible();
    await expect(canvas.getByRole("button", { name: storyText(context, copy.save) })).toBeDisabled();
  },
};

/** A starting number that isn't a whole number from 1 says so, and isn't sent. */
export const InvalidStartingNumber: Story = {
  args: { onSetStart: fn() },
  render: render(),
  play: async (context) => {
    const { canvas } = context;
    const start = canvas.getByRole("textbox", { name: storyText(context, copy.startingNumber) });
    await userEvent.clear(start);
    await userEvent.type(start, "0");
    await expect(start).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByText(storyText(context, copy.invalid))).toBeVisible();
    await expect(canvas.getByRole("button", { name: storyText(context, copy.save) })).toBeDisabled();
  },
};

/** A Project whose counters have issued nothing yet. */
export const NoCounters: Story = {
  args: { onSetStart: fn() },
  render: render({ counters: [] }),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.none))).toBeVisible();
  },
};

/** At phone width: the button is touch-sized. */
export const Phone: Story = {
  parameters: phone,
  args: { onSetStart: fn() },
  render: render(),
  play: async (context) => {
    await expectTouchTarget(context.canvas.getByRole("button", { name: storyText(context, copy.save) }));
  },
};
