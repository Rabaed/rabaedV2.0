import { formSchema, type DocumentSummary } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer, type FormFiles } from "./form-renderer.tsx";

// Named `attachments` fields (RP-281): a required Datasheet (PDF) and an
// optional Test certificate (one file). Story data only: the page uploads, and
// passes the item's Documents back in.
const schema = formSchema.parse({
  sections: [
    {
      key: "documents",
      title: { en: "Documents", ar: "المستندات" },
      fields: [
        {
          key: "datasheet",
          type: "attachments",
          required: true,
          contentTypes: ["application/pdf"],
          label: { en: "Datasheet", ar: "نشرة البيانات" },
          help: { en: "The manufacturer's datasheet for this model.", ar: "نشرة بيانات الشركة المصنعة لهذا الطراز." },
        },
        { key: "test_certificate", type: "attachments", maxFiles: 1, label: { en: "Test certificate", ar: "شهادة الاختبار" } },
      ],
    },
  ],
});

const copy = {
  datasheet: { en: "Datasheet", ar: "نشرة البيانات" },
  certificate: { en: "Test certificate", ar: "شهادة الاختبار" },
  none: { en: "No files yet.", ar: "لا توجد ملفات بعد." },
  notYet: { en: "Files can be added once the Draft is saved.", ar: "يمكن إضافة الملفات بعد حفظ المسودة." },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  full: { en: "This field takes 1 file.", ar: "يقبل هذا الحقل ملفًا واحدًا." },
  openDatasheet: { en: "Open RESCLITE-PRO datasheet.pdf", ar: "فتح \u2068RESCLITE-PRO datasheet.pdf\u2069" },
  removeDatasheet: { en: "Remove RESCLITE-PRO datasheet.pdf", ar: "إزالة \u2068RESCLITE-PRO datasheet.pdf\u2069" },
  unanswered: { en: "Not answered", ar: "لم تتم الإجابة" },
};

const document = (id: string, fieldKey: string | null, fileName: string, sizeBytes: number, frozen = false): DocumentSummary => ({
  id,
  fileName,
  sizeBytes,
  contentType: "application/pdf",
  uploadedAt: "2026-10-03T09:00:00.000Z",
  uploadedBy: { companyName: { en: "C1 Contracting", ar: "سي ون للمقاولات" }, memberName: null },
  frozen,
  fieldKey,
});

const datasheet = document("0199a3b0-0000-7000-8000-000000000101", "datasheet", "RESCLITE-PRO datasheet.pdf", 1_536_000);
const certificate = document("0199a3b0-0000-7000-8000-000000000102", "test_certificate", "Test certificate 2026.pdf", 84_000);
// The Attachments System Field's: never shown in a field.
const general = document("0199a3b0-0000-7000-8000-000000000103", null, "Cover letter.pdf", 20_000);

const files = (documents: DocumentSummary[], canChange = true): FormFiles => ({
  documents,
  canChange,
  onUpload: fn(),
  onOpen: fn(),
  onRemove: fn(),
});

const meta = {
  title: "Form engine/FormRenderer/Attachments fields",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", files: files([general]) },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No files yet: each field takes a file of its types; the Attachments System Field's file isn't shown here. */
export const Empty: Story = {
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getAllByText(storyText(context, copy.none))).toHaveLength(2);
    const input = canvas.getByLabelText(storyText(context, copy.datasheet), { exact: false });
    await expect(input).toHaveAttribute("type", "file");
    await expect(input).toHaveAttribute("accept", "application/pdf");
    await expect(input).toBeRequired();
    await expect(canvas.queryByText("Cover letter.pdf")).toBeNull();
  },
};

/** Uploaded: the files with their size, to open or remove; a full field takes no more. */
export const Uploaded: Story = {
  args: { files: files([datasheet, certificate, general]) },
  play: async (context) => {
    const { args, canvas } = context;
    await expect(canvas.getByText("RESCLITE-PRO datasheet.pdf")).toBeVisible();
    await expect(canvas.getByText(storyLocale(context) === "ar" ? /1\.5 MB/ : "1.5 MB")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openDatasheet) }));
    await expect(args.files!.onOpen).toHaveBeenCalledWith(datasheet.id);
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.removeDatasheet) }));
    await expect(args.files!.onRemove).toHaveBeenCalledWith("datasheet", datasheet.id);
    // The certificate field has its one file: no input, and it says why.
    await expect(canvas.getByText(storyText(context, copy.full))).toBeVisible();
    await expect(canvas.queryByLabelText(storyText(context, copy.certificate), { selector: "input" })).toBeNull();
  },
};

/** A required file missing when leaving Draft: the field's error, linked from the summary. */
export const WithErrors: Story = {
  args: { errors: [{ key: "datasheet", code: "required" }] },
  play: async (context) => {
    const input = context.canvas.getByLabelText(storyText(context, copy.datasheet), { exact: false });
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription(expect.stringContaining(storyText(context, copy.required)));
    await expect(context.canvas.getByRole("alert")).toBeVisible();
  },
};

/** Sent: the files are frozen; they open, but nothing is uploaded or removed. */
export const Frozen: Story = {
  args: { files: files([{ ...datasheet, frozen: true }], false) },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("button", { name: storyText(context, copy.openDatasheet) })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: storyText(context, copy.removeDatasheet) })).toBeNull();
    await expect(canvas.queryByLabelText(storyText(context, copy.datasheet), { selector: "input" })).toBeNull();
  },
};

/** A new Draft, before it exists: the fields say files come once it is saved. */
export const NotYetSaved: Story = {
  args: { files: undefined },
  play: async (context) => {
    await expect(context.canvas.getAllByText(storyText(context, copy.notYet))).toHaveLength(2);
  },
};

/** Read-only (another Company, or after Submit): each field's files to open; a field with none reads as not answered. */
export const ReadOnly: Story = {
  args: { mode: "read", files: files([{ ...datasheet, frozen: true }, general], false) },
  play: async (context) => {
    const { args, canvas } = context;
    const shown = canvas.getAllByRole("definition");
    await expect(shown[0]).toHaveTextContent("RESCLITE-PRO datasheet.pdf");
    await expect(shown[1]).toHaveTextContent(storyText(context, copy.unanswered));
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openDatasheet) }));
    await expect(args.files!.onOpen).toHaveBeenCalledWith(datasheet.id);
  },
};
