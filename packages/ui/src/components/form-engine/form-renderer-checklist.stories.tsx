import { formSchema, type DocumentSummary } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { FormRenderer, type FormFiles } from "./form-renderer.tsx";

// The `checklist` field (RP-285, spec RP-278): a pour inspection recorded item by
// item. Each item has its answer set, and a comment and a photo that are off,
// optional or required on a negative answer; the summary is counted from the
// answers. Story data only: the page uploads photos and passes the item's
// Documents back in.
const schema = formSchema.parse({
  sections: [
    {
      key: "inspection",
      title: { en: "Inspection", ar: "الفحص" },
      fields: [
        {
          key: "pour_check",
          type: "checklist",
          required: true,
          label: { en: "Pour check", ar: "فحص الصب" },
          help: { en: "Answer every item. A failed item needs its evidence.", ar: "أجب عن كل بند. البند المرفوض يحتاج إلى دليله." },
          items: [
            {
              key: "rebar_cover",
              text: { en: "Rebar cover as per drawing", ar: "الغطاء الخرساني للحديد حسب المخطط" },
              answers: "pass_fail_na",
              comment: "required_on_negative",
              photo: "required_on_negative",
            },
            {
              key: "formwork",
              text: { en: "Formwork is clean and tight", ar: "الشدة نظيفة ومحكمة" },
              answers: "pass_fail_na",
              comment: "optional",
              photo: "optional",
            },
            {
              key: "permit_on_site",
              text: { en: "Pour permit is on site", ar: "تصريح الصب موجود في الموقع" },
              answers: "yes_no_na",
              comment: "off",
              photo: "off",
            },
          ],
        },
      ],
    },
  ],
});

const copy = {
  label: { en: "Pour check", ar: "فحص الصب" },
  rebar: { en: "Rebar cover as per drawing", ar: "الغطاء الخرساني للحديد حسب المخطط" },
  formwork: { en: "Formwork is clean and tight", ar: "الشدة نظيفة ومحكمة" },
  permit: { en: "Pour permit is on site", ar: "تصريح الصب موجود في الموقع" },
  pass: { en: "Pass", ar: "مقبول" },
  fail: { en: "Fail", ar: "مرفوض" },
  na: { en: "N/A", ar: "لا ينطبق" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
  comment: { en: "Comment", ar: "التعليق" },
  commentRequired: { en: "Comment (required)", ar: "التعليق (مطلوب)" },
  photosRequired: { en: "Photos (required)", ar: "الصور (مطلوب)" },
  takePhoto: { en: "Take a photo", ar: "التقط صورة" },
  summary: { en: "Summary", ar: "الملخص" },
  notAnswered: { en: "Not answered", ar: "لم تتم الإجابة" },
  answerThis: { en: "Answer this item.", ar: "أجب عن هذا البند." },
  commentNeeded: { en: "Add a comment to explain this answer.", ar: "أضف تعليقًا يوضح هذه الإجابة." },
  photoNeeded: { en: "Add a photo as evidence for this answer.", ar: "أضف صورة كدليل لهذه الإجابة." },
  summaryFailed: { en: "1 Pass / 1 Fail / 1 N/A", ar: "1 مقبول / 1 مرفوض / 1 لا ينطبق" },
  summaryOne: { en: "1 Fail / 2 not answered", ar: "1 مرفوض / 2 بلا إجابة" },
};

/** A stand-in photo: a flat colour, inline so the story loads nothing. */
const swatch = (colour: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${colour}"/><circle cx="28" cy="10" r="5" fill="white" opacity=".6"/></svg>`)}`;

const evidence = (id: string, itemKey: string, fileName: string, frozen = false): DocumentSummary => ({
  id,
  fileName,
  sizeBytes: 2_100_000,
  contentType: "image/jpeg",
  uploadedAt: "2026-10-03T11:30:00.000Z",
  uploadedBy: { companyName: { en: "C1 Contracting", ar: "سي ون للمقاولات" }, memberName: null },
  frozen,
  fieldKey: "pour_check",
  itemKey,
  takenAt: "2026-10-03T11:22:05.000Z",
  takenWhere: { latitude: 24.7136, longitude: 46.6753 },
});

const coverPhoto = evidence("0199a3b0-0000-7000-8000-000000000301", "rebar_cover", "cover.jpg");

const files = (documents: DocumentSummary[], canChange = true): FormFiles => ({
  documents,
  canChange,
  imageUrls: { [coverPhoto.id]: swatch("slategray") },
  onUpload: fn(),
  onOpen: fn(),
  onRemove: fn(),
});

const meta = {
  title: "Form engine/FormRenderer/Checklist field",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", labels: formRendererLabels.en, files: files([]), onChange: fn() },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} labels={formRendererLabels[storyLocale(context)]} />,
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const noSidewaysScroll = () => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

/** One item's answers and evidence, found by the item's text. */
const itemOf = (context: PlayContext, name: Record<"en" | "ar", string>) =>
  within(context.canvas.getByRole("radiogroup", { name: storyText(context, name) }).closest("li")!);
/** A line of an item's text whose words are split across elements ("Photos" and "(required)"). */
const lineOf = (item: ReturnType<typeof itemOf>, name: Record<"en" | "ar", string>, context: PlayContext) =>
  item.getByText((_, element) => element?.tagName === "P" && element.textContent === storyText(context, name));
const summaryOf = (context: PlayContext) => context.canvas.getByRole("status", { name: storyText(context, copy.summary) });

/** Answering: nothing answered yet, so the summary says so; each item takes its own answer set. */
export const Empty: Story = {
  play: async (context) => {
    await expect(summaryOf(context)).toHaveTextContent(storyText(context, copy.notAnswered));
    const rebar = itemOf(context, copy.rebar);
    await expect(rebar.getByRole("radio", { name: storyText(context, copy.pass) })).toBeVisible();
    await expect(rebar.getByRole("radio", { name: storyText(context, copy.fail) })).toBeVisible();
    await expect(rebar.getByRole("radio", { name: storyText(context, copy.na) })).toBeVisible();
    const permit = itemOf(context, copy.permit);
    await expect(permit.getByRole("radio", { name: storyText(context, copy.yes) })).toBeVisible();
    await expect(permit.getByRole("radio", { name: storyText(context, copy.no) })).toBeVisible();
    // An item that asks for evidence only on a negative answer shows none yet; an optional one shows it.
    await expect(rebar.queryByLabelText(storyText(context, copy.comment), { exact: false })).toBeNull();
    await expect(itemOf(context, copy.formwork).getByLabelText(storyText(context, copy.comment))).toBeVisible();
  },
};

/**
 * Answering as a person does: a Fail on the rebar asks for its comment and a photo,
 * a Pass takes them back, and the summary follows the answers.
 */
export const AnsweringAsksForEvidence: Story = {
  render: function Render(args, context) {
    const [values, setValues] = useState<Record<string, unknown>>(args.answers);
    return (
      <FormRenderer
        {...args}
        locale={storyLocale(context)}
        labels={formRendererLabels[storyLocale(context)]}
        answers={values}
        onChange={(changes) => {
          args.onChange?.(changes);
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
    );
  },
  play: async (context) => {
    const rebar = itemOf(context, copy.rebar);
    await userEvent.click(rebar.getByRole("radio", { name: storyText(context, copy.fail) }));
    await expect(summaryOf(context)).toHaveTextContent(storyText(context, copy.summaryOne));
    await expect(rebar.getByLabelText(storyText(context, copy.commentRequired))).toBeRequired();
    await expect(lineOf(rebar, copy.photosRequired, context)).toBeVisible();
    await expect(rebar.getByLabelText(storyText(context, copy.takePhoto), { exact: false })).toHaveAttribute("capture", "environment");
    await userEvent.type(rebar.getByLabelText(storyText(context, copy.commentRequired)), "Cover 15 mm");
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ pour_check: { rebar_cover: { answer: "fail", comment: "Cover 15 mm" } } });
    // Passing it instead needs nothing: the prompts go (what was typed stays, and shows).
    await userEvent.click(rebar.getByRole("radio", { name: storyText(context, copy.pass) }));
    await expect(rebar.queryByText((_, element) => element?.tagName === "P" && element.textContent === storyText(context, copy.photosRequired))).toBeNull();
    await expect(rebar.getByLabelText(storyText(context, copy.comment), { exact: false })).toHaveValue("Cover 15 mm");
    // The photos picked go to the item.
    await userEvent.click(rebar.getByRole("radio", { name: storyText(context, copy.fail) }));
    const picked = [new File(["a"], "cover.jpg", { type: "image/jpeg" })];
    await userEvent.upload(rebar.getByLabelText(storyText(context, copy.takePhoto), { exact: false }), picked);
    await expect(context.args.files!.onUpload).toHaveBeenCalledWith("pour_check", picked, "rebar_cover");
  },
};

/** A Fail with its evidence, a Pass and an N/A: the summary counts each, and a photo shows with when and where it was taken. */
export const Answered: Story = {
  args: {
    answers: {
      pour_check: {
        rebar_cover: { answer: "fail", comment: "Cover is 15 mm on the east wall" },
        formwork: { answer: "pass" },
        permit_on_site: { answer: "na" },
      },
    },
    files: files([coverPhoto]),
  },
  play: async (context) => {
    await expect(summaryOf(context)).toHaveTextContent(storyText(context, copy.summaryFailed));
    const rebar = itemOf(context, copy.rebar);
    await expect(rebar.getByRole("radio", { name: storyText(context, copy.fail) })).toBeChecked();
    await expect(rebar.getByLabelText(storyText(context, copy.commentRequired))).toHaveValue("Cover is 15 mm on the east wall");
    await userEvent.click(rebar.getByRole("button", { name: /(Open|فتح).*cover\.jpg/ }));
    await expect(context.args.files!.onOpen).toHaveBeenCalledWith(coverPhoto.id);
  },
};

/** Leaving Draft with a Fail that lacks its evidence, an item not answered, and one with only its photo missing: each says what, under its item. */
export const EvidenceMissing: Story = {
  args: {
    answers: { pour_check: { rebar_cover: { answer: "fail" }, formwork: { answer: "fail", comment: "Gaps" } } },
    errors: [
      { key: "pour_check", code: "comment_required", item: "rebar_cover" },
      { key: "pour_check", code: "photo_required", item: "rebar_cover" },
      { key: "pour_check", code: "required", item: "permit_on_site" },
    ],
  },
  play: async (context) => {
    const rebar = itemOf(context, copy.rebar);
    await expect(rebar.getByText(storyText(context, copy.commentNeeded))).toBeVisible();
    await expect(rebar.getByText(storyText(context, copy.photoNeeded))).toBeVisible();
    await expect(rebar.getByLabelText(storyText(context, copy.commentRequired))).toBeInvalid();
    await expect(itemOf(context, copy.permit).getByText(storyText(context, copy.answerThis))).toBeVisible();
    await expect(itemOf(context, copy.formwork).queryByText(storyText(context, copy.photoNeeded))).toBeNull();
    // The summary above the Form links to the field, once.
    await expect(within(context.canvas.getByRole("alert")).getAllByRole("link", { name: storyText(context, copy.label) })).toHaveLength(1);
  },
};

/** Before the item exists (a new Draft): there is nowhere to put a photo yet. */
export const NotYetSaved: Story = {
  args: { answers: { pour_check: { rebar_cover: { answer: "fail" } } }, files: undefined },
  play: async (context) => {
    await expect(
      itemOf(context, copy.rebar).getByText(storyText(context, { en: "Photos can be added once the Draft is saved.", ar: "يمكن إضافة الصور بعد حفظ المسودة." })),
    ).toBeVisible();
  },
};

/** Read only (another Company, or after Submit): answers, comments and evidence, and the summary; nothing to change. */
export const ReadOnly: Story = {
  args: {
    mode: "read",
    answers: {
      pour_check: {
        rebar_cover: { answer: "fail", comment: "Cover is 15 mm on the east wall" },
        formwork: { answer: "pass" },
        permit_on_site: { answer: "na" },
      },
    },
    files: files([{ ...coverPhoto, frozen: true }], false),
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(summaryOf(context)).toHaveTextContent(storyText(context, copy.summaryFailed));
    await expect(canvas.queryByRole("radio")).toBeNull();
    await expect(canvas.getByText("Cover is 15 mm on the east wall")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /Remove/ })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: /(Open|فتح).*cover\.jpg/ }));
    await expect(context.args.files!.onOpen).toHaveBeenCalledWith(coverPhoto.id);
  },
};

/** Read only with nothing answered: the field reads "Not answered", like any other. */
export const ReadOnlyEmpty: Story = {
  args: { mode: "read", answers: {} },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.label)).nextElementSibling).toHaveTextContent(storyText(context, copy.notAnswered));
  },
};

/** On a phone: answers are touch-sized, the evidence prompts sit under their item, and nothing scrolls sideways. */
export const PhoneEdit: Story = {
  parameters: phone,
  args: {
    answers: { pour_check: { rebar_cover: { answer: "fail", comment: "Cover is 15 mm" }, formwork: { answer: "pass" } } },
    errors: [{ key: "pour_check", code: "photo_required", item: "rebar_cover" }],
  },
  play: async (context) => {
    const rebar = itemOf(context, copy.rebar);
    await expectTouchTarget(rebar.getByRole("radio", { name: storyText(context, copy.fail) }));
    await expectTouchTarget(rebar.getByText(storyText(context, copy.takePhoto)).closest("label")!);
    await expect(rebar.getByText(storyText(context, copy.photoNeeded))).toBeVisible();
    await noSidewaysScroll();
  },
};

/** On a phone, read only, with evidence and the summary. */
export const PhoneReadOnly: Story = {
  parameters: phone,
  args: {
    mode: "read",
    answers: { pour_check: { rebar_cover: { answer: "fail", comment: "Cover is 15 mm" }, formwork: { answer: "pass" }, permit_on_site: { answer: "na" } } },
    files: files([{ ...coverPhoto, frozen: true }], false),
  },
  play: async (context) => {
    await expect(summaryOf(context)).toHaveTextContent(storyText(context, copy.summaryFailed));
    await noSidewaysScroll();
  },
};
