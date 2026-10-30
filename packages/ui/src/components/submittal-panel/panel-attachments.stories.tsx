import { formatNumber, type Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { samplePdfUrl } from "../../storybook/fixtures/sample-pdf.ts";
import sitePhoto from "../../storybook/fixtures/site-photo.svg";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { SubmittalPanelAttachments, type SubmittalPanelAttachmentFile, type SubmittalPanelAttachmentsLabels } from "./panel-attachments.tsx";
import { SubmittalPanelSections } from "./panel-sections.tsx";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

/*
 * The Submittal Panel's Attachments (RP-1068, README §7, owner decision C3): file cards, the inline
 * preview under its card (pdf.js pages and thumbnails, or the photo), Open large over the whole
 * panel, and Esc closing the innermost layer first. Files come only from `fileUrl`, as the app's
 * come from the api's signed URL; here it hands out same-origin URLs of a PDF built in the story.
 */

type Bi = Record<Locale, string>;
const bi = (en: string, ar: string): Bi => ({ en, ar });

const copy = {
  module: bi("Submittals", "التقديمات"),
  previous: bi("Previous submittal", "التقديم السابق"),
  next: bi("Next submittal", "التقديم التالي"),
  close: bi("Close", "إغلاق"),
  hint: bi("Esc to close · ↑ ↓ to move through the list", "Esc للإغلاق · ↑ ↓ للتنقل في القائمة"),
  attachments: bi("Attachments", "المرفقات"),
  collapseAll: bi("Collapse all", "طي الكل"),
  expandAll: bi("Expand all", "فتح الكل"),
  pdf: bi("PDF", "PDF"),
  image: bi("Image", "صورة"),
  other: bi("File", "ملف"),
  files: bi("Attachments", "المرفقات"),
  none: bi("No files", "لا ملفات"),
  preview: bi("Preview", "معاينة"),
  closePreview: bi("Close preview", "إغلاق المعاينة"),
  openLarge: bi("Open large", "فتح بحجم كبير"),
  download: bi("Download", "تنزيل"),
  print: bi("Print", "طباعة"),
  back: bi("Back", "رجوع"),
  zoomIn: bi("Zoom in", "تكبير"),
  zoomOut: bi("Zoom out", "تصغير"),
  previousPage: bi("Previous page", "الصفحة السابقة"),
  nextPage: bi("Next page", "الصفحة التالية"),
  pages: bi("Pages", "الصفحات"),
  loading: bi("Opening the file…", "جارٍ فتح الملف…"),
  unavailable: bi("This file couldn't be opened.", "تعذر فتح هذا الملف."),
  tryAgain: bi("Try again", "حاول مرة أخرى"),
  noPreview: bi("This file type can't be previewed. Download it to open it.", "لا يمكن معاينة هذا النوع من الملفات. نزّله لفتحه."),
};

const labels = (locale: Locale): SubmittalPanelAttachmentsLabels => ({
  kind: { pdf: copy.pdf[locale], image: copy.image[locale], other: copy.other[locale] },
  pageCount: (n) => (locale === "ar" ? `${n} صفحات` : `${n} pages`),
  pageOf: (page, pages) => `${page} / ${pages}`,
  ofAttachments: () => (locale === "ar" ? "مرفقات" : "attachments"),
  page: (n) => (locale === "ar" ? `صفحة ${n}` : `Page ${n}`),
  files: copy.files[locale],
  pages: copy.pages[locale],
  none: copy.none[locale],
  preview: copy.preview[locale],
  closePreview: copy.closePreview[locale],
  openLarge: copy.openLarge[locale],
  download: copy.download[locale],
  print: copy.print[locale],
  back: copy.back[locale],
  close: copy.close[locale],
  zoomIn: copy.zoomIn[locale],
  zoomOut: copy.zoomOut[locale],
  previousPage: copy.previousPage[locale],
  nextPage: copy.nextPage[locale],
  loading: copy.loading[locale],
  unavailable: copy.unavailable[locale],
  tryAgain: copy.tryAgain[locale],
  noPreview: copy.noPreview[locale],
});

/** A size as the app's messages word it (`workItems.attachments.mb` / `.kb`). */
const mb = (size: string, locale: Locale) => (locale === "ar" ? `${size} م.ب` : `${size} MB`);
const kb = (size: string, locale: Locale) => (locale === "ar" ? `${size} ك.ب` : `${size} KB`);

const filesIn = (locale: Locale): SubmittalPanelAttachmentFile[] => [
  { id: "datasheet", name: "LED-1200_Datasheet.pdf", contentType: "application/pdf", size: mb("2.4", locale) },
  { id: "compliance", name: "Compliance_Statement.pdf", contentType: "application/pdf", size: kb("640", locale) },
  // The fixture is an SVG; the app previews JPEG, PNG and WebP the same way.
  { id: "photo", name: "Sample_board_photo.jpg", contentType: "image/jpeg", size: mb("1.1", locale) },
  { id: "drawing", name: "Ceiling_layout_L3.dwg", contentType: "image/vnd.dwg", size: mb("3.8", locale) },
];

/** The URLs the story's "api" hands out: a 3-page and a 2-page PDF, and the photo. */
function useFileUrl(refused: readonly string[]) {
  return useMemo(() => {
    const urls: Record<string, () => string> = { datasheet: () => samplePdfUrl(3), compliance: () => samplePdfUrl(2), photo: () => sitePhoto };
    return async (id: string) => {
      // A file the viewer may not see: the api answers 404, so no URL is handed out.
      if (refused.includes(id) || !urls[id]) throw new Error("not_found");
      return urls[id]();
    };
  }, [refused]);
}

function AttachmentsDemo({ context, width = 640, refused = [] }: { context: StoryContext; width?: number; refused?: string[] }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const fileUrl = useFileUrl(refused);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // What reached the panel: Esc that closed it, ↓ that moved to the next submittal.
  const [closed, setClosed] = useState(0);
  const [moved, setMoved] = useState(0);
  return (
    <div className="p-4">
      <output data-closed={closed} data-moved={moved} />
      <SubmittalPanel
        locale={locale}
        labels={{
          module: copy.module[locale],
          position: (n, total) => `${n} / ${total}`,
          previous: copy.previous[locale],
          next: copy.next[locale],
          close: copy.close[locale],
          hint: copy.hint[locale],
        }}
        crumb={<DocNo value="TWR-TMC-EL-MAR-042" />}
        width={width}
        onClose={() => setClosed((n) => n + 1)}
        onNext={() => setMoved((n) => n + 1)}
        labelledBy={ids.labelledBy}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={{ number: "TWR-TMC-EL-MAR-042", revisionNo: null }}
            noNumber=""
            subject={locale === "ar" ? "وحدات إضاءة LED خطية" : "Linear LED fixtures"}
            numberId={ids.numberId}
            subjectId={ids.subjectId}
          />
        }
      >
        <SubmittalPanelSections
          locale={locale}
          labels={{ count: (n) => (locale === "ar" ? `${n} قسم` : `${n} section`), collapseAll: copy.collapseAll[locale], expandAll: copy.expandAll[locale] }}
          sections={[
            {
              key: "attachments",
              icon: "paperclip",
              title: copy.attachments[locale],
              summary: locale === "ar" ? `${formatNumber(filesIn(locale).length, locale)} ملفات` : `${formatNumber(filesIn(locale).length, locale)} files`,
              children: <SubmittalPanelAttachments locale={locale} labels={labels(locale)} files={filesIn(locale)} fileUrl={fileUrl} />,
            },
          ]}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />
      </SubmittalPanel>
    </div>
  );
}

const meta = {
  title: "Views/Submittal Panel/Attachments",
  parameters: overlay,
  render: (_args, context) => <AttachmentsDemo context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog", { name: /TWR-TMC-EL-MAR-042/ });
const cardOf = (context: PlayContext, id: string) => panelOf(context).querySelector<HTMLElement>(`[data-attachment="${id}"]`)!;
const previewOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>("[data-attachment-preview]");
const output = (context: PlayContext) => context.canvasElement.querySelector<HTMLOutputElement>("output")!.dataset;
const button = (scope: HTMLElement, context: PlayContext, name: Bi) => within(scope).getByRole("button", { name: storyText(context, name) });
const shown = (el: Element | null) => el !== null && el.checkVisibility();

/** Waits for the preview's or Open large's pages (or photo) to be drawn, so the screenshot has them. */
async function drawn(scope: HTMLElement) {
  await waitFor(() => expect(scope.querySelector('[data-state="ready"]')).not.toBeNull(), { timeout: 15000 });
}

/**
 * pdf.js draws a page's text in its canvas's direction: in an Arabic panel the pages and their
 * thumbnails must still be left to right, or a Latin PDF's words come out scrambled.
 */
async function pagesLeftToRight(scope: HTMLElement) {
  const canvases = [...scope.querySelectorAll("canvas")];
  await expect(canvases.length).toBeGreaterThan(0);
  for (const canvas of canvases) await expect(getComputedStyle(canvas).direction).toBe("ltr");
}

/** Opens the datasheet's preview from its card. */
async function openDatasheet(context: PlayContext) {
  await userEvent.click(button(cardOf(context, "datasheet"), context, copy.preview));
  const preview = previewOf(context)!;
  await drawn(preview);
  return preview;
}

/**
 * A card per file: its type, its name left to right in Arabic too, its type and size, and
 * Preview, Open large and Download; a drawing a browser can't draw offers Download only.
 */
export const Files: Story = {
  play: async (context) => {
    const card = cardOf(context, "datasheet");
    await expect(card).toHaveTextContent(`LED-1200_Datasheet.pdfPDF · ${mb("2.4", storyLocale(context))}`);
    await expect(getComputedStyle(within(card).getByText("LED-1200_Datasheet.pdf")).direction).toBe("ltr");
    await expect(within(card).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      storyText(context, copy.preview),
      storyText(context, copy.openLarge),
      storyText(context, copy.download),
    ]);
    await expect(button(cardOf(context, "datasheet"), context, copy.preview)).toHaveAttribute("aria-expanded", "false");
    await expect(within(cardOf(context, "drawing")).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([storyText(context, copy.download)]);
    // Two columns from the Normal band.
    await expect(cardOf(context, "compliance").getBoundingClientRect().top).toBe(card.getBoundingClientRect().top);
    await expect(previewOf(context)).toBeNull();
  },
};

/**
 * Preview opens inline, directly under its card and across the section, never a pop-up: a dark
 * toolbar (name, page "1 / 3", zoom in 10% steps, Open large, Download, Print, Close), 440px of
 * pages in the Normal band with a 72px thumbnail column. The card is outlined as the active one,
 * and now says how many pages the PDF has. Zoom redraws the pages; a thumbnail goes to its page;
 * ↑ / ↓ in the pages scroll them and don't move to the next submittal; Preview again closes it.
 */
export const Preview: Story = {
  play: async (context) => {
    const card = cardOf(context, "datasheet");
    const preview = await openDatasheet(context);
    await expect(preview.previousElementSibling).toBe(card);
    await expect(preview.getBoundingClientRect().width).toBe(card.parentElement!.getBoundingClientRect().width);
    await expect(button(card, context, copy.preview)).toHaveAttribute("aria-expanded", "true");
    await expect(button(card, context, copy.preview)).toHaveAttribute("aria-controls", preview.id);
    await expect(card).toHaveAttribute("data-active", "true");
    const withPages = storyLocale(context) === "ar" ? "PDF · 3 صفحات · 2.4 م.ب" : "PDF · 3 pages · 2.4 MB";
    await expect(card).toHaveTextContent(withPages);

    await expect(within(preview).getByText("1 / 3")).toBeVisible();
    await expect(within(preview).getByText("100%")).toBeVisible();
    for (const name of [copy.zoomOut, copy.zoomIn, copy.openLarge, copy.download, copy.print, copy.closePreview]) await expect(button(preview, context, name)).toBeVisible();
    const body = preview.lastElementChild!;
    await expect(body.getBoundingClientRect().height).toBe(440);
    const thumbs = within(preview).getByRole("group", { name: storyText(context, copy.pages) });
    await expect(shown(thumbs)).toBe(true);
    await expect(thumbs.getBoundingClientRect().width).toBe(72);
    await expect(within(thumbs).getAllByRole("button")).toHaveLength(3);
    await expect(within(preview).getAllByRole("img")).toHaveLength(3);
    await pagesLeftToRight(preview);

    const page1 = within(preview).getAllByRole("img")[0]!;
    const before = page1.getBoundingClientRect().width;
    await userEvent.click(button(preview, context, copy.zoomIn));
    await expect(within(preview).getByText("110%")).toBeVisible();
    await waitFor(() => expect(Math.round(page1.getBoundingClientRect().width)).toBe(Math.round((before * 110) / 100)));
    await drawn(preview);
    await userEvent.click(button(preview, context, copy.zoomOut));
    await drawn(preview);

    await userEvent.click(within(thumbs).getAllByRole("button")[2]!);
    await expect(within(preview).getByText("3 / 3")).toBeVisible();
    await expect(within(thumbs).getAllByRole("button")[2]).toHaveAttribute("aria-current", "page");

    // Page 3 is drawn once it comes near the view.
    await drawn(preview);
    within(preview).getByRole("group", { name: "LED-1200_Datasheet.pdf" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(output(context).moved).toBe("0");

    await userEvent.click(button(card, context, copy.preview));
    await expect(previewOf(context)).toBeNull();
    await expect(card).not.toHaveAttribute("data-active");
    // The page count stays on the card once read.
    await expect(card).toHaveTextContent(withPages);
    await userEvent.click(button(card, context, copy.preview));
    await drawn(previewOf(context)!);
    // Back to page 1 at 100%, the screenshot's state; nothing focused.
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/** In the Compact band the preview is 360px, with no thumbnails, page chip or zoom: the pages scroll. */
export const PreviewCompact: Story = {
  render: (_args, context) => <AttachmentsDemo context={context} width={440} />,
  play: async (context) => {
    const preview = await openDatasheet(context);
    await expect(preview.lastElementChild!.getBoundingClientRect().height).toBe(360);
    await expect(shown(preview.querySelector(".sdp-att-thumbs"))).toBe(false);
    await expect(within(preview).queryByText("1 / 3")).not.toBeVisible();
    await expect(shown(within(preview).getByRole("button", { name: storyText(context, copy.zoomIn), hidden: true }))).toBe(false);
    await expect(button(preview, context, copy.openLarge)).toBeVisible();
    // One column of cards, and nothing scrolls sideways.
    await expect(cardOf(context, "compliance").getBoundingClientRect().top).toBeGreaterThan(cardOf(context, "datasheet").getBoundingClientRect().top);
    const body = panelOf(context).querySelector(".sdp-body")!;
    await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/** In the Wide band (and Full) the preview is 560px tall. */
export const PreviewWide: Story = {
  render: (_args, context) => <AttachmentsDemo context={context} width={960} />,
  play: async (context) => {
    const preview = await openDatasheet(context);
    await expect(preview.lastElementChild!.getBoundingClientRect().height).toBe(560);
    await expect(shown(within(preview).getByRole("group", { name: storyText(context, copy.pages) }))).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/** An image's preview shows the photo, with zoom and no pages. */
export const Photo: Story = {
  play: async (context) => {
    await userEvent.click(button(cardOf(context, "photo"), context, copy.preview));
    const preview = previewOf(context)!;
    await drawn(preview);
    await expect(within(preview).getByRole("img", { name: "Sample_board_photo.jpg" })).toBeVisible();
    await expect(within(preview).queryByRole("group", { name: storyText(context, copy.pages) })).toBeNull();
    await expect(within(preview).getByText("100%")).toBeVisible();
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/**
 * Open large fills the panel itself (not the screen), with Back first, the file's place among the
 * section's, page and zoom controls (25% steps) and the file switcher. ↑ / ↓ don't move to another
 * submittal while it is open. Esc closes it first, then the preview, then the panel.
 */
export const OpenLarge: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await openDatasheet(context);
    await userEvent.click(button(previewOf(context)!, context, copy.openLarge));
    const large = within(panel).getByRole("dialog", { name: "LED-1200_Datasheet.pdf" });
    await drawn(large);
    await pagesLeftToRight(large);
    // The whole panel inside its border.
    const fill = large.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    await expect([fill.top, fill.left - box.left - panel.clientLeft, fill.width, fill.height]).toEqual([box.top, 0, panel.clientWidth, panel.clientHeight]);
    await expect(button(large, context, copy.back)).toHaveFocus();
    await expect(large).toHaveTextContent(storyLocale(context) === "ar" ? "1 / 4 مرفقات · 2.4 م.ب" : "1 / 4 attachments · 2.4 MB");

    await expect(button(large, context, copy.previousPage)).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button(large, context, copy.nextPage));
    await expect(within(large).getByText("2 / 3")).toBeVisible();
    // The last page, however short: Next is then unavailable and keeps the focus, inside Open large.
    await userEvent.click(button(large, context, copy.nextPage));
    await expect(within(large).getByText("3 / 3")).toBeVisible();
    await expect(button(large, context, copy.nextPage)).toHaveAttribute("aria-disabled", "true");
    await expect(button(large, context, copy.nextPage)).toHaveFocus();
    await userEvent.click(button(large, context, copy.nextPage));
    await expect(within(large).getByText("3 / 3")).toBeVisible();
    await userEvent.click(button(large, context, copy.zoomIn));
    await expect(within(large).getByText("125%")).toBeVisible();

    await userEvent.keyboard("{ArrowDown}");
    await expect(output(context).moved).toBe("0");

    // The switcher: another file, back at its first page and 100%.
    const switcher = within(large).getByRole("group", { name: storyText(context, copy.files) });
    await userEvent.click(within(switcher).getByRole("button", { name: "Compliance_Statement.pdf" }));
    const other = within(panel).getByRole("dialog", { name: "Compliance_Statement.pdf" });
    await drawn(other);
    await expect(within(other).getByText("1 / 2")).toBeVisible();
    await expect(within(other).getByText("100%")).toBeVisible();
    await expect(within(switcher).getByRole("button", { name: "Compliance_Statement.pdf" })).toHaveAttribute("aria-current", "true");

    await userEvent.keyboard("{Escape}");
    await expect(within(panel).queryByRole("dialog")).toBeNull();
    await expect(previewOf(context)).not.toBeNull();
    await expect(output(context).closed).toBe("0");
    await userEvent.keyboard("{Escape}");
    await expect(previewOf(context)).toBeNull();
    await expect(output(context).closed).toBe("0");
    await userEvent.keyboard("{Escape}");
    await expect(output(context).closed).toBe("1");

    // Open again, for the screenshot.
    await userEvent.click(button(cardOf(context, "datasheet"), context, copy.openLarge));
    await drawn(within(panel).getByRole("dialog", { name: "LED-1200_Datasheet.pdf" }));
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/**
 * A file the viewer may not see: the api refuses its URL (404), so the preview says the file
 * couldn't be opened, with Try again, and draws nothing of it.
 */
export const Unavailable: Story = {
  render: (_args, context) => <AttachmentsDemo context={context} refused={["datasheet"]} />,
  play: async (context) => {
    await userEvent.click(button(cardOf(context, "datasheet"), context, copy.preview));
    const preview = previewOf(context)!;
    const alert = await within(preview).findByRole("alert");
    await expect(alert).toHaveTextContent(storyText(context, copy.unavailable));
    await expect(preview.querySelector("canvas, img")).toBeNull();
    await userEvent.click(button(preview, context, copy.tryAgain));
    await expect(await within(preview).findByRole("alert")).toBeVisible();
    await expect(preview.querySelector("canvas, img")).toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
  },
};
