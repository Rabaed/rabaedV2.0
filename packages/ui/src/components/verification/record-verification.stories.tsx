import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { codeFormLabels, storyPdf, storyVerification, verificationLabels } from "../../storybook/verification.ts";
import { RecordVerificationView, VerificationCodeForm } from "./record-verification.tsx";

// The public verification page of a Documental Record (RP-157; visibility.md, the Verification page
// row): interim, built from the kit's parts, no reference screen yet (RP-665; restyle RP-666). Story
// data only: a made-up record. The copy check runs Web Crypto in the browser on the chosen file.

const meta = {
  title: "Records/RecordVerification",
  component: RecordVerificationView,
  args: { verification: storyVerification(), locale: "en", labels: verificationLabels.en },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="mx-auto max-w-xl">
        <RecordVerificationView {...args} locale={locale} labels={verificationLabels[locale]} />
      </div>
    );
  },
} satisfies Meta<typeof RecordVerificationView>;

export default meta;
type Story = StoryObj<typeof meta>;

const pdf = (bytes: Uint8Array<ArrayBuffer>, name: string) => new File([bytes], name, { type: "application/pdf" });
const choose = async (file: File, label: string) => {
  const input = screen.getByLabelText(label, { selector: "input" });
  await userEvent.upload(input, file);
};

/** Genuine: what the first page prints, and each signer with their Position and Company. Nothing else. */
export const Genuine: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const l = verificationLabels[locale];
    await expect(await screen.findByRole("status")).toHaveTextContent(l.genuine);
    const page = screen.getByTestId("record-verification");
    await expect(page).toHaveTextContent("TWR-MAR-01-0007 Rev 1");
    await expect(page).toHaveTextContent(locale === "en" ? "Huda Harbi" : "هدى الحربي");
    await expect(page).toHaveTextContent(locale === "en" ? "Delta Consultants" : "دلتا للاستشارات");
    // The Document Number reads left to right in both languages.
    await expect(within(page).getByText("TWR-MAR-01-0007 Rev 1")).toHaveAttribute("dir", "ltr");
  },
};

/** Replaced by a corrected copy: says when, and asks the holder to check their copy. */
export const Replaced: Story = {
  args: { verification: storyVerification(true) },
  play: async (context) => {
    const l = verificationLabels[storyLocale(context)];
    const status = await screen.findByRole("status");
    await expect(status).toHaveTextContent(l.replacedHint);
    await expect(status).toHaveTextContent(storyLocale(context) === "en" ? "30 August 2027" : "2027");
  },
};

/** A dropped copy that is the original: fingerprinted in the browser, nothing uploaded. */
export const CopyIsTheOriginal: Story = {
  play: async (context) => {
    const l = verificationLabels[storyLocale(context)];
    await choose(pdf(storyPdf.original, "TWR-MAR-01-0007.pdf"), l.chooseFile);
    const result = await screen.findByTestId("copy-result");
    await expect(result).toHaveTextContent(l.original);
    await expect(result).toHaveAttribute("data-tone", "success");
  },
};

/** A copy a corrected one replaced: recognised, with the date it was replaced. */
export const CopyWasReplaced: Story = {
  args: { verification: storyVerification(true) },
  play: async (context) => {
    const locale = storyLocale(context);
    await choose(pdf(storyPdf.replaced, "TWR-MAR-01-0007-old.pdf"), verificationLabels[locale].chooseFile);
    const result = await screen.findByTestId("copy-result");
    await expect(result).toHaveAttribute("data-tone", "danger");
    await expect(result).toHaveTextContent(locale === "en" ? "replaced by a corrected copy on 30 August 2027" : "استُبدلت");
  },
};

/** Any other file: not this record. */
export const CopyIsDifferent: Story = {
  play: async (context) => {
    const l = verificationLabels[storyLocale(context)];
    await choose(pdf(storyPdf.other, "edited.pdf"), l.chooseFile);
    const result = await screen.findByTestId("copy-result");
    await expect(result).toHaveTextContent(l.different);
    await expect(result).toHaveAttribute("data-tone", "danger");
  },
};

/** The Verification Code with the Document Number, both typed left to right. */
export const CodeForm: Story = {
  render: (_args, context) => (
    <div className="mx-auto max-w-xl">
      <VerificationCodeForm action={fn()} labels={codeFormLabels[storyLocale(context)]} />
    </div>
  ),
  play: async (context) => {
    const l = codeFormLabels[storyLocale(context)];
    await expect(screen.getByRole("textbox", { name: l.code })).toHaveAttribute("dir", "ltr");
    await expect(screen.getByRole("textbox", { name: l.documentNumber })).toHaveAttribute("dir", "ltr");
    await expect(screen.getByRole("button", { name: l.submit })).toBeInTheDocument();
    await expect(screen.queryByRole("alert")).toBeNull();
  },
};

const refusals = {
  notFound: {
    en: { title: "No record matches", body: "Type the Verification Code and the Document Number exactly as the record prints them." },
    ar: { title: "لا يوجد سجل مطابق", body: "تحقق من رمز التحقق ورقم المستند كما هما مطبوعان في السجل." },
  },
  tooMany: {
    en: { title: "Too many attempts", body: "Try again in 15 minutes, or scan the record's QR." },
    ar: { title: "محاولات كثيرة", body: "حاول مرة أخرى بعد 15 دقيقة، أو امسح رمز QR في السجل." },
  },
};

/** No such record: the same whatever was wrong, the code, the number, or both. */
export const NoSuchRecord: Story = {
  render: (_args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="mx-auto max-w-xl">
        <VerificationCodeForm action={fn()} labels={codeFormLabels[locale]} defaultCode="7K3M-Q9TB" defaultDocumentNumber="TWR-MAR-01-0099" refusal={refusals.notFound[locale]} />
      </div>
    );
  },
  play: async (context) => {
    await expect(await screen.findByRole("alert")).toHaveTextContent(refusals.notFound[storyLocale(context)].title);
  },
};

/** Too many attempts from this visitor. */
export const TooManyAttempts: Story = {
  render: (_args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="mx-auto max-w-xl">
        <VerificationCodeForm action={fn()} labels={codeFormLabels[locale]} refusal={refusals.tooMany[locale]} />
      </div>
    );
  },
  play: async (context) => {
    await expect(await screen.findByRole("alert")).toHaveTextContent(refusals.tooMany[storyLocale(context)].title);
  },
};
