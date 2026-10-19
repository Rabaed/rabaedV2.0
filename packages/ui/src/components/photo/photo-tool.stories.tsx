import type { DocumentSummary, Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import annotatedImage from "../../storybook/fixtures/ceiling-photo-annotated.svg";
import ceilingImage from "../../storybook/fixtures/ceiling-photo.svg";
import sitePhoto from "../../storybook/fixtures/site-photo.svg";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { markColours } from "./annotate-marks.ts";
import { PhotoAnnotator, type PhotoAnnotatorLabels } from "./photo-annotator.tsx";
import { PhotoTool, type PhotoToolLabels } from "./photo-tool.tsx";

// The one photo tool (RP-656), at phone width: Take photo or Upload, the
// thumbnails (a photo with an annotated copy shows the copy, marked
// "Annotated"), the full-screen viewer with Annotated / Original, and the
// annotate view with its arrow, rectangle, circle, pen and text tools. There is
// no Claude Design reference screen yet (INSP-8, RP-118): built from
// design/prompts/inspection-on-phone.md and the kit. Story data and wording
// only: the page passes its own messages, Documents and image URLs.

const isolate = (name: string) => `\u2068${name}\u2069`;

const annotatorLabels: Record<Locale, PhotoAnnotatorLabels> = {
  en: {
    title: (name) => `Annotate ${name}`,
    cancel: "Cancel",
    undo: "Undo",
    save: "Save",
    saving: "Saving…",
    failed: "The annotated photo wasn't saved. Try again.",
    canvas: "The photo, to mark up",
    tools: "Tools",
    tool: { arrow: "Arrow", rectangle: "Rectangle", circle: "Circle", pen: "Pen", text: "Text" },
    colours: "Colour",
    colour: { red: "Red", yellow: "Yellow", blue: "Blue", white: "White", black: "Black" },
    labelText: "Label text",
    addLabel: "Add label",
  },
  ar: {
    title: (name) => `تعليم ${isolate(name)}`,
    cancel: "إلغاء",
    undo: "تراجع",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    failed: "لم تُحفظ الصورة المعلَّمة. حاول مرة أخرى.",
    canvas: "الصورة، للتعليم عليها",
    tools: "الأدوات",
    tool: { arrow: "سهم", rectangle: "مستطيل", circle: "دائرة", pen: "قلم", text: "نص" },
    colours: "اللون",
    colour: { red: "أحمر", yellow: "أصفر", blue: "أزرق", white: "أبيض", black: "أسود" },
    labelText: "نص التسمية",
    addLabel: "إضافة التسمية",
  },
};

const toolLabels: Record<Locale, PhotoToolLabels> = {
  en: {
    none: "No photos yet.",
    takePhoto: "Take photo",
    upload: "Upload",
    uploading: "Uploading…",
    open: (name) => `Open ${name}`,
    remove: (name) => `Remove ${name}`,
    annotatedMark: "Annotated",
    full: "This item takes at most 3 photos.",
    viewer: { close: "Close", show: "Show", annotated: "Annotated", original: "Original", annotate: "Annotate", noImage: "No image to show." },
    annotator: annotatorLabels.en,
  },
  ar: {
    none: "لا توجد صور بعد.",
    takePhoto: "التقط صورة",
    upload: "رفع",
    uploading: "جارٍ الرفع…",
    open: (name) => `فتح ${isolate(name)}`,
    remove: (name) => `إزالة ${isolate(name)}`,
    annotatedMark: "معلَّمة",
    full: "يقبل هذا البند 3 صور على الأكثر.",
    viewer: { close: "إغلاق", show: "عرض", annotated: "المعلَّمة", original: "الأصلية", annotate: "تعليم", noImage: "لا توجد صورة لعرضها." },
    annotator: annotatorLabels.ar,
  },
};

const copy = {
  group: { en: "Photos: Ceiling void above corridor C3", ar: "الصور: الفراغ فوق سقف الممر C3" },
  openCeiling: { en: "Open ceiling.jpg", ar: `فتح ${isolate("ceiling.jpg")}` },
  removeCeiling: { en: "Remove ceiling.jpg", ar: `إزالة ${isolate("ceiling.jpg")}` },
  label: { en: "Leak", ar: "تسرب" },
};

const photo = (id: string, fileName: string, extra: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id,
  fileName,
  sizeBytes: 2_400_000,
  contentType: "image/jpeg",
  uploadedAt: "2026-10-17T08:30:00.000Z",
  uploadedBy: { companyName: { en: "K1 Consultants", ar: "كي ون للاستشارات" }, memberName: null },
  frozen: false,
  fieldKey: "checklist",
  itemKey: "ceiling_void",
  annotatedFromId: null,
  takenAt: "2026-10-17T08:28:00.000Z",
  takenWhere: null,
  ...extra,
});

const ceiling = photo("0199a3b0-0000-7000-8000-000000000301", "ceiling.jpg");
const ceilingAnnotated = photo("0199a3b0-0000-7000-8000-000000000302", "ceiling-annotated.jpg", { annotatedFromId: ceiling.id, contentType: "image/jpeg" });
const duct = photo("0199a3b0-0000-7000-8000-000000000303", "duct.jpg");
const imageUrls = { [ceiling.id]: ceilingImage, [ceilingAnnotated.id]: annotatedImage, [duct.id]: sitePhoto };

const meta = {
  title: "Photo/PhotoTool",
  component: PhotoTool,
  parameters: phone,
  args: {
    documents: [],
    imageUrls,
    canChange: true,
    label: copy.group.en,
    labels: toolLabels.en,
    onUpload: fn(),
    onRemove: fn(),
    onSaveAnnotated: fn(),
  },
  render: (args, context) => <PhotoTool {...args} label={storyText(context, copy.group)} labels={toolLabels[storyLocale(context)]} />,
} satisfies Meta<typeof PhotoTool>;

export default meta;
type Story = StoryObj<typeof meta>;

const noSidewaysScroll = () => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
const words = (context: StoryContext) => toolLabels[storyLocale(context)];

/** No photos yet: Take photo opens the phone's back camera; Upload picks several from the gallery or files. */
export const Empty: Story = {
  play: async (context) => {
    const { args, canvas } = context;
    const text = words(context);
    await expect(canvas.getByText(text.none)).toBeVisible();
    const camera = canvas.getByLabelText(text.takePhoto);
    await expect(camera).toHaveAttribute("capture", "environment");
    await expect(camera).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/heic");
    const upload = canvas.getByLabelText(text.upload);
    await expect(upload).toHaveAttribute("multiple");
    await expect(upload).not.toHaveAttribute("capture");
    const picked = [new File(["a"], "one.jpg", { type: "image/jpeg" }), new File(["b"], "two.jpg", { type: "image/jpeg" })];
    await userEvent.upload(upload, picked);
    await expect(args.onUpload).toHaveBeenCalledWith(picked);
    await expectTouchTarget(canvas.getByText(text.takePhoto).closest("label")!);
    await noSidewaysScroll();
  },
};

/** Two photos, one annotated: its thumbnail shows the annotated copy, marked; the copy is no photo of its own. */
export const WithPhotos: Story = {
  args: { documents: [ceiling, ceilingAnnotated, duct] },
  play: async (context) => {
    const { args, canvas } = context;
    const text = words(context);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(2);
    await expect(canvas.getAllByText(text.annotatedMark)).toHaveLength(1);
    const thumbnail = canvas.getByRole("button", { name: storyText(context, copy.openCeiling) });
    await expect(thumbnail.querySelector("img")).toHaveAttribute("src", annotatedImage);
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.removeCeiling) }));
    await expect(args.onRemove).toHaveBeenCalledWith(ceiling.id);
    await expectTouchTarget(canvas.getByRole("button", { name: storyText(context, copy.removeCeiling) }));
    await noSidewaysScroll();
  },
};

/** At the most photos the item takes: no more to add, and it says so. */
export const Full: Story = {
  args: { documents: [ceiling, ceilingAnnotated, duct, photo("0199a3b0-0000-7000-8000-000000000304", "tile.jpg")], maxPhotos: 3 },
  play: async (context) => {
    const text = words(context);
    await expect(context.canvas.getByText(text.full)).toBeVisible();
    await expect(context.canvas.queryByLabelText(text.takePhoto)).toBeNull();
  },
};

/** Read only (after the item was sent, or another Company's): open and switch, nothing to add, remove or annotate. */
export const ReadOnly: Story = {
  args: { documents: [{ ...ceiling, frozen: true }, { ...ceilingAnnotated, frozen: true }], canChange: false },
  play: async (context) => {
    const { canvas } = context;
    const text = words(context);
    await expect(canvas.queryByLabelText(text.takePhoto)).toBeNull();
    await expect(canvas.queryByRole("button", { name: storyText(context, copy.removeCeiling) })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openCeiling) }));
    const viewer = within(await screen.findByRole("dialog"));
    await expect(viewer.queryByRole("button", { name: text.viewer.annotate })).toBeNull();
    await userEvent.click(viewer.getByRole("button", { name: text.viewer.close }));
  },
};

/** A photo opened full screen: the annotated copy first, and Annotated / Original to switch to the untouched original. */
export const Viewer: Story = {
  parameters: { ...phone, ...overlay },
  args: { documents: [ceiling, ceilingAnnotated, duct] },
  play: async (context) => {
    const text = words(context);
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.openCeiling) }));
    const viewer = within(await screen.findByRole("dialog"));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", annotatedImage);
    await userEvent.click(viewer.getByRole("radio", { name: text.viewer.original }));
    await expect(viewer.getByRole("img")).toHaveAttribute("src", ceilingImage);
    await expect(viewer.getByRole("img")).toHaveAccessibleName("ceiling.jpg");
    await userEvent.click(viewer.getByRole("radio", { name: text.viewer.annotated }));
    await expect(viewer.getByRole("button", { name: text.viewer.annotate })).toBeVisible();
  },
};

/**
 * A reply Screen's photos (RP-981): a check item's photos the Consultant Engineer takes on site. The page passes
 * the holder's right to add to the field (`canChangeReplies`) as `canChange`. A photo waiting for the code is
 * annotated like any other, its copy a reply Document beside it; one an earlier Transition took is frozen,
 * so it is only opened, Annotated / Original switching on both.
 */
export const ReplyPhotos: Story = {
  parameters: { ...phone, ...overlay },
  args: {
    documents: [
      { ...ceiling, reply: { taken: false } },
      { ...ceilingAnnotated, reply: { taken: false } },
      { ...duct, frozen: true, reply: { taken: true } },
      photo("0199a3b0-0000-7000-8000-000000000305", "duct-annotated.jpg", { annotatedFromId: duct.id, frozen: true, reply: { taken: true } }),
    ],
    imageUrls: { ...imageUrls, "0199a3b0-0000-7000-8000-000000000305": annotatedImage },
  },
  play: async (context) => {
    const { args, canvas } = context;
    const text = words(context);
    await expect(canvas.getAllByText(text.annotatedMark)).toHaveLength(2);
    await expect(canvas.getByRole("button", { name: storyText(context, copy.removeCeiling) })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: text.remove("duct.jpg") })).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: text.open("duct.jpg") }));
    const taken = within(await screen.findByRole("dialog"));
    await userEvent.click(taken.getByRole("radio", { name: text.viewer.original }));
    await expect(taken.getByRole("img")).toHaveAttribute("src", sitePhoto);
    await expect(taken.queryByRole("button", { name: text.viewer.annotate })).toBeNull();
    await userEvent.click(taken.getByRole("button", { name: text.viewer.close }));

    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.openCeiling) }));
    const waiting = within(await screen.findByRole("dialog"));
    await expect(waiting.getByRole("img")).toHaveAttribute("src", annotatedImage);
    await userEvent.click(waiting.getByRole("radio", { name: text.viewer.original }));
    await expect(waiting.getByRole("img")).toHaveAttribute("src", ceilingImage);
    await userEvent.click(waiting.getByRole("button", { name: text.viewer.annotate }));
    await expect(await screen.findByRole("dialog", { name: text.annotator.title("ceiling.jpg") })).toBeVisible();
    await expect(args.onSaveAnnotated).not.toHaveBeenCalled();
  },
};

/** Annotate from the viewer: draw an arrow, Save, and the page gets the drawn image for the original. */
export const AnnotateAndSave: Story = {
  parameters: { ...phone, ...overlay },
  args: { documents: [ceiling, duct] },
  play: async (context) => {
    const { args } = context;
    const text = words(context);
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.openCeiling) }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: text.viewer.annotate }));
    const view = within(await screen.findByRole("dialog", { name: text.annotator.title("ceiling.jpg") }));
    const save = view.getByRole("button", { name: text.annotator.save });
    await expect(save).toBeDisabled();
    const photoCanvas = await view.findByRole("img", { name: text.annotator.canvas });
    const box = photoCanvas.getBoundingClientRect();
    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: photoCanvas, coords: { clientX: box.x + box.width * 0.2, clientY: box.y + box.height * 0.7 } },
      { target: photoCanvas, coords: { clientX: box.x + box.width * 0.5, clientY: box.y + box.height * 0.4 } },
      { keys: "[/MouseLeft]", target: photoCanvas, coords: { clientX: box.x + box.width * 0.5, clientY: box.y + box.height * 0.4 } },
    ]);
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(args.onSaveAnnotated).toHaveBeenCalledWith(ceiling.id, expect.any(Blob)));
    const image = (args.onSaveAnnotated as ReturnType<typeof fn>).mock.calls[0]![1] as Blob;
    await expect(image.type).toBe("image/jpeg");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: text.annotator.title("ceiling.jpg") })).toBeNull());
  },
};

/** The annotate view with an arrow, a circle and a text label drawn on a photo (the design request's screen). */
export const AnnotateView: StoryObj<typeof PhotoAnnotator> = {
  parameters: { ...phone, ...overlay },
  render: (_args, context) => (
    <PhotoAnnotator
      open
      onOpenChange={fn()}
      imageUrl={ceilingImage}
      fileName="ceiling.jpg"
      labels={annotatorLabels[storyLocale(context)]}
      onSave={fn()}
      defaultMarks={[
        { tool: "circle", colour: markColours[0].value, from: { x: 0.45, y: 0.22 }, to: { x: 0.78, y: 0.41 } },
        { tool: "arrow", colour: markColours[0].value, from: { x: 0.3, y: 0.62 }, to: { x: 0.5, y: 0.42 } },
        { tool: "text", colour: markColours[0].value, at: { x: 0.3, y: 0.68 }, text: storyText(context, copy.label) },
      ]}
    />
  ),
  play: async (context) => {
    const text = annotatorLabels[storyLocale(context)];
    const view = within(await screen.findByRole("dialog", { name: text.title("ceiling.jpg") }));
    await expect(view.getByRole("radio", { name: text.tool.arrow })).toBeChecked();
    await expect(view.getByRole("radio", { name: text.colour.red })).toBeChecked();
    await expect(view.getByRole("button", { name: text.save })).toBeEnabled();
    await expectTouchTarget(view.getByRole("radio", { name: text.colour.yellow }));
    await expectTouchTarget(view.getByRole("button", { name: text.undo }));
  },
};

/** The text tool: tap where the label goes, type it, add it; Undo takes the last mark off again. */
export const TextLabel: StoryObj<typeof PhotoAnnotator> = {
  parameters: { ...phone, ...overlay },
  render: (_args, context) => (
    <PhotoAnnotator open onOpenChange={fn()} imageUrl={ceilingImage} fileName="ceiling.jpg" labels={annotatorLabels[storyLocale(context)]} onSave={fn()} />
  ),
  play: async (context) => {
    const text = annotatorLabels[storyLocale(context)];
    const view = within(await screen.findByRole("dialog", { name: text.title("ceiling.jpg") }));
    await userEvent.click(view.getByRole("radio", { name: text.tool.text }));
    await userEvent.type(view.getByRole("textbox", { name: text.labelText }), storyText(context, copy.label));
    await userEvent.click(view.getByRole("button", { name: text.addLabel }));
    const undo = view.getByRole("button", { name: text.undo });
    await expect(undo).toBeEnabled();
    await userEvent.click(undo);
    await expect(undo).toBeDisabled();
  },
};
