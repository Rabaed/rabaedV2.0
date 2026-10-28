import { formSchema, type DocumentSummary } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { overlay } from "../../storybook/overlay.ts";
import { FormRenderer, type FormFiles } from "./form-renderer.tsx";

// The `photos` field (RP-284): Sample photos, up to 4, taken with the phone's
// camera or chosen. Each shows when and where it was taken (its EXIF, as the api
// read it), or that it records neither. A photo opens full screen, to annotate
// while it may change (RP-656, RP-1056); one with an annotated copy shows the
// copy, marked, and opens with Annotated / Original. Story data only: the page
// uploads, and passes the item's Documents and their image URLs back in.
const schema = formSchema.parse({
  sections: [
    {
      key: "photos",
      title: { en: "Photos", ar: "الصور" },
      fields: [
        {
          key: "sample_photos",
          type: "photos",
          required: true,
          maxFiles: 4,
          label: { en: "Sample photos", ar: "صور العينة" },
          help: { en: "The sample as delivered to site.", ar: "العينة كما وصلت إلى الموقع." },
        },
      ],
    },
  ],
});

const copy = {
  label: { en: "Sample photos", ar: "صور العينة" },
  takePhoto: { en: "Take a photo", ar: "التقط صورة" },
  none: { en: "No photos yet.", ar: "لا توجد صور بعد." },
  notYet: { en: "Photos can be added once the Draft is saved.", ar: "يمكن إضافة الصور بعد حفظ المسودة." },
  nothingRecorded: { en: "No time/location recorded", ar: "لم يُسجَّل وقت أو موقع" },
  taken: { en: "Taken ", ar: "التُقطت " },
  place: { en: "24.71360° N, 46.67530° E", ar: "24.71360° N, 46.67530° E" },
  full: { en: "This field takes at most 4 photos.", ar: "يقبل هذا الحقل 4 صور على الأكثر." },
  openFacade: { en: "Open facade.jpg full size", ar: "فتح \u2068facade.jpg\u2069 بالحجم الكامل" },
  removeFacade: { en: "Remove facade.jpg", ar: "إزالة \u2068facade.jpg\u2069" },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
};

/** A stand-in photo: a flat colour, inline so the story loads nothing. */
const swatch = (colour: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${colour}"/><circle cx="28" cy="10" r="5" fill="white" opacity=".6"/></svg>`)}`;

const photo = (id: string, fileName: string, taken: Pick<DocumentSummary, "takenAt" | "takenWhere">, frozen = false): DocumentSummary => ({
  id,
  fileName,
  sizeBytes: 2_400_000,
  contentType: "image/jpeg",
  uploadedAt: "2026-10-03T11:30:00.000Z",
  uploadedBy: { companyName: { en: "C1 Contracting", ar: "سي ون للمقاولات" }, memberName: null },
  frozen,
  fieldKey: "sample_photos",
  itemKey: null,
  annotatedFromId: null,
  ...taken,
});

// 14:22 in Riyadh, at the site.
const facade = photo("0199a3b0-0000-7000-8000-000000000201", "facade.jpg", {
  takenAt: "2026-10-03T11:22:05.000Z",
  takenWhere: { latitude: 24.7136, longitude: 46.6753 },
});
// A photo whose EXIF was stripped (sent through a chat app, say).
const forwarded = photo("0199a3b0-0000-7000-8000-000000000202", "IMG-20261003-WA0007.jpg", { takenAt: null, takenWhere: null });
// A camera with its clock set but no GPS.
const label = photo("0199a3b0-0000-7000-8000-000000000203", "label.jpg", { takenAt: "2026-10-03T11:25:40.000Z", takenWhere: null });

// Facade's annotated copy: a Document of its own, in the same field, naming its original.
const facadeAnnotated: DocumentSummary = { ...facade, id: "0199a3b0-0000-7000-8000-000000000205", fileName: "facade-annotated.jpg", annotatedFromId: facade.id };

const imageUrls = {
  [facade.id]: swatch("slategray"),
  [forwarded.id]: swatch("tan"),
  [label.id]: swatch("darkseagreen"),
  [facadeAnnotated.id]: swatch("firebrick"),
};

const files = (documents: DocumentSummary[], canChange = true): FormFiles => ({
  documents,
  canChange,
  imageUrls,
  onUpload: fn(),
  onOpen: fn(),
  onRemove: fn(),
  onSaveAnnotated: fn(),
});

const meta = {
  title: "Form engine/FormRenderer/Photos field",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", labels: formRendererLabels.en, files: files([]) },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} labels={formRendererLabels[storyLocale(context)]} />,
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

const noSidewaysScroll = () => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

/** No photos yet: choose several images, or take one with the camera. */
export const Empty: Story = {
  play: async (context) => {
    const { args, canvas } = context;
    await expect(canvas.getByText(storyText(context, copy.none))).toBeVisible();
    const choose = canvas.getByLabelText(storyText(context, copy.label), { exact: false });
    await expect(choose).toHaveAttribute("type", "file");
    await expect(choose).toHaveAttribute("multiple");
    await expect(choose).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/heic");
    await expect(choose).toBeRequired();
    const camera = canvas.getByLabelText(storyText(context, copy.takePhoto));
    await expect(camera).toHaveAttribute("capture", "environment");
    const picked = [new File(["a"], "one.jpg", { type: "image/jpeg" }), new File(["b"], "two.jpg", { type: "image/jpeg" })];
    await userEvent.upload(choose, picked);
    await expect(args.files!.onUpload).toHaveBeenCalledWith("sample_photos", picked);
  },
};

const words = (context: Parameters<typeof storyLocale>[0]) => formRendererLabels[storyLocale(context)].photos;

/** Photos taken: thumbnails with when and where, or that the photo records neither; open full screen, or remove. */
export const WithPhotos: Story = {
  args: { files: files([facade, forwarded, label]) },
  play: async (context) => {
    const { args, canvas } = context;
    const text = words(context);
    await expect(canvas.getByText(copy.place.en)).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.nothingRecorded))).toBeVisible();
    await expect(canvas.getAllByText(storyText(context, copy.taken), { exact: false })).toHaveLength(2);
    // Full screen in the page, not a file in another tab; Annotate while the photo may change.
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openFacade) }));
    const viewer = within(await screen.findByRole("dialog", { name: "facade.jpg" }));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", imageUrls[facade.id]);
    await expect(viewer.queryByRole("radio", { name: text.viewer.original })).toBeNull();
    await expect(viewer.getByRole("button", { name: text.viewer.annotate })).toBeVisible();
    await userEvent.click(viewer.getByRole("button", { name: text.viewer.close }));
    await expect(args.files!.onOpen).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.removeFacade) }));
    await expect(args.files!.onRemove).toHaveBeenCalledWith("sample_photos", facade.id);
  },
};

/**
 * A photo with an annotated copy: its thumbnail shows the copy, marked "Annotated", and the copy is
 * no photo of its own (nor counted toward the field's 4). It opens on the copy, and Annotated /
 * Original switches to the untouched original; Annotate opens the annotate view on the photo shown.
 */
export const Annotated: Story = {
  parameters: overlay,
  args: { files: files([facade, facadeAnnotated, forwarded, label]) },
  play: async (context) => {
    const { args, canvas } = context;
    const text = words(context);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getAllByText(text.annotatedMark)).toHaveLength(1);
    const thumbnail = canvas.getByRole("button", { name: storyText(context, copy.openFacade) });
    await expect(thumbnail.querySelector("img")).toHaveAttribute("src", imageUrls[facadeAnnotated.id]);
    await expect(canvas.getByLabelText(storyText(context, copy.takePhoto))).toBeInTheDocument();

    await userEvent.click(thumbnail);
    const viewer = within(await screen.findByRole("dialog", { name: "facade.jpg" }));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", imageUrls[facadeAnnotated.id]);
    await userEvent.click(viewer.getByRole("radio", { name: text.viewer.original }));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", imageUrls[facade.id]);
    await userEvent.click(viewer.getByRole("button", { name: text.viewer.annotate }));
    await expect(await screen.findByRole("dialog", { name: text.annotator.title("facade.jpg") })).toBeVisible();
    await expect(args.files!.onSaveAnnotated).not.toHaveBeenCalled();
  },
};

/** A Submitted (frozen) photo in a field that still takes photos: opened and switched, never annotated again (RP-656-1). */
export const FrozenNotAnnotated: Story = {
  args: { files: files([{ ...facade, frozen: true }, { ...facadeAnnotated, frozen: true }, forwarded]) },
  play: async (context) => {
    const text = words(context);
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.openFacade) }));
    const viewer = within(await screen.findByRole("dialog", { name: "facade.jpg" }));
    await expect(viewer.getByRole("radio", { name: text.viewer.original })).toBeVisible();
    await expect(viewer.queryByRole("button", { name: text.viewer.annotate })).toBeNull();
    await userEvent.click(viewer.getByRole("button", { name: text.viewer.close }));
    await userEvent.click(context.canvas.getByRole("button", { name: text.open("IMG-20261003-WA0007.jpg") }));
    const other = within(await screen.findByRole("dialog"));
    await expect(other.getByRole("button", { name: text.viewer.annotate })).toBeVisible();
    // Closed again, so the screenshot shows the field.
    await userEvent.click(other.getByRole("button", { name: text.viewer.close }));
  },
};

/** A HEIC original the browser can't show, with an annotated JPEG copy it can: opened in the page, on the copy. */
export const HeicWithCopy: Story = {
  args: {
    files: {
      ...files([{ ...facade, fileName: "facade.heic", contentType: "image/heic" }, facadeAnnotated]),
      imageUrls: { [facadeAnnotated.id]: imageUrls[facadeAnnotated.id]! },
    },
  },
  play: async (context) => {
    const { args, canvas } = context;
    const text = words(context);
    await userEvent.click(canvas.getByRole("button", { name: text.open("facade.heic") }));
    const viewer = within(await screen.findByRole("dialog", { name: "facade.heic" }));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", imageUrls[facadeAnnotated.id]);
    await userEvent.click(viewer.getByRole("radio", { name: text.viewer.original }));
    await expect(viewer.getByText(text.viewer.noImage)).toBeVisible();
    await expect(args.files!.onOpen).not.toHaveBeenCalled();
    // Closed again, so the screenshot shows the field.
    await userEvent.click(viewer.getByRole("button", { name: text.viewer.close }));
  },
};

/** A photo the browser can't show (a HEIC, or its URL not there yet) opens as a file, as before. */
export const NoImageOpensFile: Story = {
  args: { files: { ...files([facade]), imageUrls: {} } },
  play: async (context) => {
    const { args, canvas } = context;
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openFacade) }));
    await expect(args.files!.onOpen).toHaveBeenCalledWith(facade.id);
    await expect(screen.queryByRole("dialog")).toBeNull();
  },
};

/** A required field with no photo when leaving Draft: the field's error, linked from the summary. */
export const WithErrors: Story = {
  args: { errors: [{ key: "sample_photos", code: "required" }] },
  play: async (context) => {
    const input = context.canvas.getByLabelText(storyText(context, copy.label), { exact: false });
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription(expect.stringContaining(storyText(context, copy.required)));
  },
};

/** Full: four photos, and the field says it takes no more. */
export const Full: Story = {
  args: {
    files: files([facade, forwarded, label, { ...label, id: "0199a3b0-0000-7000-8000-000000000204", fileName: "label-2.jpg" }]),
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByText(storyText(context, copy.full))).toBeVisible();
    await expect(canvas.queryByLabelText(storyText(context, copy.takePhoto))).toBeNull();
    await expect(canvas.getByRole("group", { name: storyText(context, copy.label) })).toBeVisible();
  },
};

/** A new Draft, before it exists: photos come once it is saved. */
export const NotYetSaved: Story = {
  args: { files: undefined },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.notYet))).toBeVisible();
  },
};

/** Read-only (another Company, or after Submit): the photos with when and where, to open and switch; nothing to remove or annotate. */
export const ReadOnly: Story = {
  args: { mode: "read", files: files([{ ...facade, frozen: true }, { ...facadeAnnotated, frozen: true }, { ...forwarded, frozen: true }], false) },
  play: async (context) => {
    const { canvas } = context;
    const text = words(context);
    await expect(canvas.getByText(copy.place.en)).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.nothingRecorded))).toBeVisible();
    await expect(canvas.queryByRole("button", { name: storyText(context, copy.removeFacade) })).toBeNull();
    await expect(canvas.getAllByText(text.annotatedMark)).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openFacade) }));
    const viewer = within(await screen.findByRole("dialog", { name: "facade.jpg" }));
    await userEvent.click(viewer.getByRole("radio", { name: text.viewer.original }));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", imageUrls[facade.id]);
    await expect(viewer.queryByRole("button", { name: text.viewer.annotate })).toBeNull();
    // Closed again, so the screenshot shows the field.
    await userEvent.click(viewer.getByRole("button", { name: text.viewer.close }));
  },
};

/** On a phone, with a photo with EXIF and one without: two per row, touch-sized buttons, nothing scrolls sideways. */
export const PhoneEdit: Story = {
  parameters: phone,
  args: { files: files([facade, forwarded]) },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByText(storyText(context, copy.nothingRecorded))).toBeVisible();
    await expectTouchTarget(canvas.getByRole("button", { name: storyText(context, copy.removeFacade) }));
    await expectTouchTarget(canvas.getByText(storyText(context, copy.takePhoto)).closest("label")!);
    await noSidewaysScroll();
  },
};

/** On a phone, read only, with and without EXIF. */
export const PhoneReadOnly: Story = {
  parameters: phone,
  args: { mode: "read", files: files([{ ...facade, frozen: true }, { ...forwarded, frozen: true }, { ...label, frozen: true }], false) },
  play: async (context) => {
    await expect(context.canvas.getByText(copy.place.en)).toBeVisible();
    await noSidewaysScroll();
  },
};
