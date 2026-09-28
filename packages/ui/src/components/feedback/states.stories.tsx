import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { Button } from "../button/button.tsx";
import { EmptyState, ErrorState, Loading, Skeleton } from "./states.tsx";

const copy = {
  emptyTitle: { en: "Nothing with you", ar: "لا شيء لديك" },
  emptyText: { en: "Work Items that need your action will show here.", ar: "ستظهر هنا بنود العمل التي تحتاج إلى إجراء منك." },
  create: { en: "Create a Submittal", ar: "إنشاء تقديم" },
  errorTitle: { en: "Couldn't load Work Items", ar: "تعذّر تحميل بنود العمل" },
  errorText: { en: "Check your connection, then try again.", ar: "تحقق من الاتصال ثم حاول مرة أخرى." },
  retry: { en: "Try again", ar: "حاول مرة أخرى" },
  loading: { en: "Loading Work Items", ar: "جارٍ تحميل بنود العمل" },
};

type Args = { onAction: () => void };

const meta: Meta<Args> = {
  title: "Feedback/States",
  args: { onAction: fn() },
};

export default meta;
type Story = StoryObj<Args>;

/** Empty: an icon, a heading, a sentence and an optional action. */
export const Empty: Story = {
  render: (args, context) => (
    <EmptyState
      icon="clipboard-check"
      title={storyText(context, copy.emptyTitle)}
      action={<Button onClick={args.onAction}>{storyText(context, copy.create)}</Button>}
    >
      {storyText(context, copy.emptyText)}
    </EmptyState>
  ),
  play: async (context) => {
    const { canvas, args } = context;
    await expect(canvas.getByRole("heading", { name: storyText(context, copy.emptyTitle) })).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.emptyText))).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.create) }));
    await expect(args.onAction).toHaveBeenCalledOnce();
  },
};

/** Empty without an action, e.g. when the Member may not create anything here. */
export const EmptyWithoutAction: Story = {
  render: (_args, context) => (
    <EmptyState icon="clipboard-check" title={storyText(context, copy.emptyTitle)}>
      {storyText(context, copy.emptyText)}
    </EmptyState>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** Error: announced when it appears, with a way to try again. */
export const Error: Story = {
  render: (args, context) => (
    <ErrorState
      title={storyText(context, copy.errorTitle)}
      action={
        <Button variant="secondary" onClick={args.onAction}>
          {storyText(context, copy.retry)}
        </Button>
      }
    >
      {storyText(context, copy.errorText)}
    </ErrorState>
  ),
  play: async (context) => {
    const { canvas, args } = context;
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveTextContent(storyText(context, copy.errorTitle));
    await expect(canvas.getByRole("heading", { name: storyText(context, copy.errorTitle) })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.retry) }));
    await expect(args.onAction).toHaveBeenCalledOnce();
  },
};

/** Loading: skeletons in the shape of the content, hidden from screen readers, which hear the label instead. */
export const LoadingList: Story = {
  render: (_args, context) => (
    <Loading label={storyText(context, copy.loading)} className="flex max-w-md flex-col gap-3">
      {[1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
          <Skeleton className="size-10 rounded-sm" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </Loading>
  ),
  play: async (context) => {
    const status = context.canvas.getByRole("status", { name: storyText(context, copy.loading) });
    await expect(status).toHaveAttribute("aria-busy", "true");
    // The placeholders themselves are not in the accessibility tree.
    await expect(context.canvas.queryAllByRole("presentation")).toHaveLength(0);
    for (const skeleton of status.querySelectorAll("[data-skeleton]")) await expect(skeleton.closest("[aria-hidden=true]")).not.toBeNull();
  },
};
