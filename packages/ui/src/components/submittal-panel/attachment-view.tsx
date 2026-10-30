"use client";

import { formatNumber, type Locale } from "@rabaed/domain";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { attachmentPageAt, type SubmittalPanelAttachmentKind } from "./attachments-model.ts";
import type { AttachmentLoad } from "./attachment-files.ts";
import { isCancelled, type LoadedPdf } from "./pdf-loader.ts";


/** A file type's icon (the icon set registers no PDF glyph: a PDF is a text file in a red tile). */
export const attachmentIcon: Record<SubmittalPanelAttachmentKind, IconName> = { pdf: "file-text", image: "photo", other: "file" };
const tileTone: Record<SubmittalPanelAttachmentKind, string> = { pdf: "bg-danger-tint text-danger-fg", image: "bg-info-tint text-info-fg", other: "bg-neutral-tint text-neutral-fg" };

/** A file's type tile. */
export function AttachmentTile({ kind, className }: { kind: SubmittalPanelAttachmentKind; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-[6px]", tileTone[kind], className)}>
      <Icon name={attachmentIcon[kind]} size={18} />
    </span>
  );
}

/**
 * A Document's name, cut to one line: left to right as a whole, in Arabic too, so a long one is
 * cut at its end, never its start, and on the side the locale reads from (`drawer.css` `.dfile b`).
 */
export const attachmentNameClass = "truncate [direction:ltr] text-left rtl:text-right";

export type AttachmentViewLabels = {
  /** "Page 3": a page's and its thumbnail's name. */
  page: (n: string) => string;
  /** The page thumbnails' name. */
  pages: string;
  loading: string;
  /** "This file couldn't be opened." */
  unavailable: string;
  tryAgain: string;
  /** What a file a browser can't draw says instead (a drawing, an Office file). */
  noPreview: string;
};

/** Where the view scrolls to: a new `seq` scrolls again to the same page. */
export type AttachmentPageJump = { page: number; seq: number };

export type AttachmentViewProps = {
  locale: Locale;
  labels: AttachmentViewLabels;
  name: string;
  kind: SubmittalPanelAttachmentKind;
  load: AttachmentLoad | undefined;
  onRetry: () => void;
  zoom: number;
  /** The page shown changed, as the viewer scrolled. */
  onPage: (page: number) => void;
  jump: AttachmentPageJump | null;
  /** The 72px page-thumbnail column, from the Normal band up (the inline preview's; Open large has none). */
  thumbnails?: boolean;
};

/** How much of the scroll area a page or photo spans at 100%, as the design draws it (`drawer.js`). */
const pageShare = 0.88;
const photoShare = 0.92;
/** The scroll area's padding, around the pages. */
const padding = 18;
const thumbnailWidth = 52;

/**
 * A file's pages or photo (RP-1068, README §7), inside the inline preview or Open large: a PDF's
 * pages drawn by pdf.js, stacked in a scroll area, with page thumbnails beside them; an image's
 * photo. While its file is read it says so; a file that can't be read (one the viewer may not see
 * gets the api's 404) says it couldn't be opened, with Try again, and shows nothing else.
 */
export function AttachmentView({ locale, labels, name, kind, load, onRetry, zoom, onPage, jump, thumbnails = false }: AttachmentViewProps) {
  if (kind === "other") return <Message>{labels.noPreview}</Message>;
  if (!load || load.status === "loading") return <Message role="status">{labels.loading}</Message>;
  if (load.status === "failed")
    return (
      <Message role="alert">
        {labels.unavailable}
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {labels.tryAgain}
        </Button>
      </Message>
    );
  if (kind === "image") return <Photo url={load.file.url} name={name} zoom={zoom} />;
  // Read, but pdf.js can't open it (damaged, or locked with a password): Download still has it.
  if (!load.file.pdf) return <Message role="alert">{labels.unavailable}</Message>;
  return <PdfPages locale={locale} labels={labels} name={name} pdf={load.file.pdf} zoom={zoom} onPage={onPage} jump={jump} thumbnails={thumbnails} />;
}

function Message({ role, children }: { role?: "status" | "alert"; children: ReactNode }) {
  return (
    <div role={role} className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-on-inverse/80">
      {children}
    </div>
  );
}

/** The scroll area's width in whole pixels, padding left out, followed as the panel is resized. */
function useScrollerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => setWidth(Math.max(0, Math.floor(box.clientWidth - 2 * padding)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * The page keys the panel would take as its own (↑ / ↓ to the previous or next submittal): here
 * they scroll the pages, so they stop at the view. Their default, the scroll, still happens.
 */
const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
export function keepScrollKeys(event: KeyboardEvent) {
  if (scrollKeys.has(event.key)) event.stopPropagation();
}

const scrollerClass = cn("min-h-0 min-w-0 flex-1 overflow-auto", focusRing, "focus-visible:-outline-offset-2");

function PdfPages({
  locale,
  labels,
  name,
  pdf,
  zoom,
  onPage,
  jump,
  thumbnails,
}: {
  locale: Locale;
  labels: AttachmentViewLabels;
  name: string;
  pdf: LoadedPdf;
  zoom: number;
  onPage: (page: number) => void;
  jump: AttachmentPageJump | null;
  thumbnails: boolean;
}) {
  const scroller = useScrollerWidth();
  const pageWidth = Math.round((scroller.width * pageShare * zoom) / 100);
  const pages = Array.from({ length: pdf.pages }, (_, i) => i + 1);
  // The pages near the view: only they are drawn, so a long drawing set doesn't hold every page's canvas.
  const [near, setNear] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    const box = scroller.ref.current;
    if (!box || pageWidth === 0) return;
    const observer = new IntersectionObserver(
      (entries) =>
        setNear((all) => {
          const next = new Set(all);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        }),
      { root: box, rootMargin: "50% 0px" },
    );
    for (const sheet of box.querySelectorAll("[data-page]")) observer.observe(sheet);
    return () => observer.disconnect();
  }, [scroller.ref, pageWidth, pdf]);
  // What is drawn, by "<page or thumb>-<page>-<width>": the view is ready once the pages near it and the thumbnails are.
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(new Set());
  const markDrawn = (key: string) => setDrawn((all) => (all.has(key) ? all : new Set(all).add(key)));
  const ready =
    near.size > 0 && [...near].every((n) => drawn.has(`page-${n}-${pageWidth}`)) && (!thumbnails || pages.every((n) => drawn.has(`thumb-${n}-${thumbnailWidth}`)));
  const [shown, setShown] = useState(1);
  const n = (value: number) => formatNumber(value, locale);

  const scrollToPage = (page: number) => {
    const box = scroller.ref.current;
    const sheet = box?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (box && sheet) box.scrollTop = sheet.offsetTop - padding;
    setShown(page);
    onPage(page);
  };
  const scrollTo = useEffectEvent(scrollToPage);
  useEffect(() => {
    if (jump) scrollTo(jump.page);
  }, [jump]);

  const onScroll = () => {
    const box = scroller.ref.current;
    if (!box) return;
    const tops = [...box.querySelectorAll<HTMLElement>("[data-page]")].map((sheet) => sheet.offsetTop - padding);
    // Scrolled to the end, the last page is shown, even one too short for its top to reach the top.
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    const page = atEnd ? tops.length : attachmentPageAt(box.scrollTop + 1, tops);
    if (page === shown) return;
    setShown(page);
    onPage(page);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {thumbnails && (
        <div
          role="group"
          aria-label={labels.pages}
          className="sdp-att-thumbs hidden w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-e border-on-inverse/10 bg-on-inverse/5 p-2.5 @[560px]/sdp:flex"
        >
          {pages.map((page) => (
            <button
              key={page}
              type="button"
              aria-label={labels.page(n(page))}
              aria-current={page === shown ? "page" : undefined}
              onClick={() => scrollToPage(page)}
              className={cn("shrink-0 rounded-[4px] opacity-70 hover:opacity-100", focusRing, page === shown && "opacity-100 ring-2 ring-brand")}
            >
              <PdfCanvas pdf={pdf} page={page} width={thumbnailWidth} onDrawn={() => markDrawn(`thumb-${page}-${thumbnailWidth}`)} className="rounded-[4px]" />
            </button>
          ))}
        </div>
      )}
      <div
        ref={scroller.ref}
        tabIndex={0}
        role="group"
        aria-label={name}
        data-state={ready ? "ready" : "drawing"}
        onScroll={onScroll}
        onKeyDown={keepScrollKeys}
        className={cn(scrollerClass, "relative")}
        style={{ padding }}
      >
        {pageWidth > 0 && (
          <div className="flex flex-col gap-4">
            {pages.map((page) => (
              <PdfCanvas
                key={page}
                pdf={pdf}
                page={page}
                width={pageWidth}
                draw={near.has(page)}
                label={labels.page(n(page))}
                onDrawn={() => markDrawn(`page-${page}-${pageWidth}`)}
                className="mx-auto shrink-0 shadow-lg"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One PDF page `width` CSS pixels wide (whole pixels, so its box never lands between two), drawn
 * while `draw` (near the view); away from it, its bitmap is released and the box stays, blank.
 */
function PdfCanvas({
  pdf,
  page,
  width,
  draw = true,
  label,
  onDrawn,
  className,
}: {
  pdf: LoadedPdf;
  page: number;
  width: number;
  draw?: boolean;
  label?: string;
  onDrawn: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The width it was last drawn at: coming back near the view at the same size draws nothing again.
  const drawnAt = useRef(0);
  // The first page's shape until this page is read to be drawn, then its own.
  const [aspect, setAspect] = useState(() => pdf.aspect(page));
  const drawn = useEffectEvent(onDrawn);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!draw) {
      // Away from the view: its bitmap (up to 16M pixels) is given back, and drawn again when it comes near.
      canvas.width = 0;
      canvas.height = 0;
      drawnAt.current = 0;
      return;
    }
    if (drawnAt.current === width) return drawn();
    const render = pdf.render(page, canvas, width);
    render.done.then(
      () => {
        drawnAt.current = width;
        setAspect(pdf.aspect(page));
        drawn();
      },
      (error: unknown) => {
        // A page that fails to draw stays blank; a cancelled one is drawn again at its new size.
        if (!isCancelled(error)) drawn();
      },
    );
    return () => render.cancel();
  }, [pdf, page, width, draw]);
  const height = Math.round(width / aspect);
  return (
    // Left to right in an Arabic panel too: pdf.js draws a page's text in its canvas's direction,
    // and a right-to-left one scrambles the words. The thumbnails stay where the panel's direction puts them.
    <canvas
      ref={ref}
      dir="ltr"
      data-page={label ? page : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width, height }}
      className={cn("block", className)}
    />
  );
}

function Photo({ url, name, zoom }: { url: string; name: string; zoom: number }) {
  const scroller = useScrollerWidth();
  const [loaded, setLoaded] = useState(false);
  const width = Math.round((scroller.width * photoShare * zoom) / 100);
  return (
    <div
      ref={scroller.ref}
      tabIndex={0}
      role="group"
      aria-label={name}
      data-state={loaded && width > 0 ? "ready" : "drawing"}
      onKeyDown={keepScrollKeys}
      className={cn(scrollerClass, "flex")}
      style={{ padding }}
    >
      {width > 0 && (
        // A same-origin URL of the bytes already read (`useAttachmentFiles`), never the signed URL itself.
        <img src={url} alt={name} onLoad={() => setLoaded(true)} style={{ width }} className="m-auto block h-auto max-w-none shrink-0" />
      )}
    </div>
  );
}
