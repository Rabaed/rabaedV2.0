import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { ToastProvider, useToast, type ToastTone } from "./toast.tsx";

const copy = {
  saved: { en: "Draft saved", ar: "تم حفظ المسودة" },
  savedText: { en: "Only your company can see it.", ar: "لا يراها إلا فريق شركتك." },
  failed: { en: "Couldn't submit", ar: "تعذّر الإرسال" },
  failedText: { en: "Check your connection and try again.", ar: "تحقق من الاتصال وحاول مرة أخرى." },
  save: { en: "Save draft", ar: "حفظ المسودة" },
  submit: { en: "Submit", ar: "إرسال" },
  region: { en: "Notifications", ar: "الإشعارات" },
  close: { en: "Dismiss", ar: "إغلاق" },
};

function Actions({ context }: { context: StoryContext }) {
  const toast = useToast();
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  const show = (tone: ToastTone) =>
    tone === "danger"
      ? toast({ tone, title: t(copy.failed), description: t(copy.failedText) })
      : toast({ tone, title: t(copy.saved), description: t(copy.savedText) });
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={() => show("success")}>
        {t(copy.save)}
      </Button>
      <Button onClick={() => show("danger")}>{t(copy.submit)}</Button>
    </div>
  );
}

const meta = {
  title: "Overlays/Toast",
  render: (_args, context) => (
    <ToastProvider label={storyText(context, copy.region)} closeLabel={storyText(context, copy.close)} duration={Infinity}>
      <Actions context={context} />
    </ToastProvider>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** The live regions (polite or assertive) that currently contain `text`. */
function announcing(text: string) {
  return [...document.querySelectorAll("[aria-live=polite], [aria-live=assertive]")]
    .filter((region) => region.textContent?.includes(text))
    .map((region) => region.getAttribute("aria-live"));
}

const button = (context: PlayContext, text: { en: string; ar: string }) =>
  context.canvas.getByRole("button", { name: storyText(context, text) });

/** Success: shown at the inline-end corner and announced politely. Left open for the screenshot. */
export const Success: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(button(context, copy.save));
    await expect(await screen.findByText(storyText(context, copy.saved))).toBeVisible();
    await waitFor(() => expect(announcing(storyText(context, copy.saved))).toContain("polite"));
  },
};

/** An error is announced at once (assertive), not after the user's current task. */
export const Danger: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(button(context, copy.submit));
    await screen.findByText(storyText(context, copy.failed));
    await waitFor(() => expect(announcing(storyText(context, copy.failed))).toContain("assertive"));
  },
};

/** The dismiss button closes it. */
export const Dismiss: Story = {
  play: async (context) => {
    await userEvent.click(button(context, copy.save));
    await screen.findByText(storyText(context, copy.saved));
    await userEvent.click(screen.getByRole("button", { name: storyText(context, copy.close) }));
    await waitFor(() => expect(screen.queryByText(storyText(context, copy.saved))).toBeNull());
  },
};

/** On a phone: the buttons and the toast's dismiss button are at least 44 × 44px. Left open for the screenshot. */
export const Phone: Story = {
  parameters: { ...phone, ...overlay },
  play: async (context) => {
    for (const text of [copy.save, copy.submit]) await expectTouchTarget(button(context, text));
    await userEvent.click(button(context, copy.save));
    await screen.findByText(storyText(context, copy.saved));
    await expectTouchTarget(screen.getByRole("button", { name: storyText(context, copy.close) }));
  },
};
