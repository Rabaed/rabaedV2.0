"use client";

import { formatNumber, type Locale } from "@rabaed/domain";
import { Fragment, useEffect, useEffectEvent, useId, useRef, useState, type MouseEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { onBar } from "../photo/photo-screen.tsx";
import { printAttachment, saveAttachment, useAttachmentFiles, type AttachmentLoad } from "./attachment-files.ts";
import { AttachmentTile, AttachmentView, attachmentIcon, type AttachmentPageJump, type AttachmentViewLabels } from "./attachment-view.tsx";
import { attachmentKind, attachmentLayerToClose, attachmentZoom, attachmentZoomStep, type SubmittalPanelAttachmentKind } from "./attachments-model.ts";
import { SubmittalPanelAttachmentViewer } from "./panel-attachment-viewer.tsx";

export type SubmittalPanelAttachmentFile = {
  /** The Document's id: what `fileUrl` is asked for, never shown. */
  id: string;
  name: string;
  contentType: string;
  /** Its size, formatted ("2.4 MB"). */
  size: string;
};

export type SubmittalPanelAttachmentsLabels = AttachmentViewLabels & {
  /** "PDF", "Image", "File". */
  kind: Record<SubmittalPanelAttachmentKind, string>;
  /** "12 pages", once pdf.js has read the file: formatted (`n`) and as a number for the plural (`count`). */
  pageCount: (n: string, count: number) => string;
  /** "1 / 12": the page shown, left to right in Arabic too. */
  pageOf: (page: string, pages: string) => string;
  /** "attachments", after Open large's "1 / 3" (the file shown among the section's `count`). */
  ofAttachments: (count: number) => string;
  /** The file switcher's name in Open large. */
  files: string;
  /** What a section with no files says. */
  none: string;
  preview: string;
  closePreview: string;
  openLarge: string;
  download: string;
  print: string;
  back: string;
  close: string;
  zoomIn: string;
  zoomOut: string;
  previousPage: string;
  nextPage: string;
};

export type SubmittalPanelAttachmentsProps = {
  locale: Locale;
  labels: SubmittalPanelAttachmentsLabels;
  files: readonly SubmittalPanelAttachmentFile[];
  /**
   * A URL to read the file from: the api's short-lived signed download URL, issued after its
   * access check. It rejects when the api refuses (a file the viewer may not see is a 404).
   */
  fileUrl: (id: string) => Promise<string>;
};

/** A view's zoom and page, reset when its file changes. */
export type AttachmentPlace = { zoom: number; page: number; jump: AttachmentPageJump | null };
const start: AttachmentPlace = { zoom: 100, page: 1, jump: null };

/** Another layer open over the panel that Esc is for first: a pop-up, a menu, the number card. */
const otherLayer = '[role="dialog"][data-state="open"]:not([data-attachment-viewer]), [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-number-card]:not([hidden])';

/**
 * The Attachments section's body (RP-1068, README §7, owner decision C3): a card per file with its
 * type, name (left to right), "PDF · 12 pages · 2.4 MB", and Preview, Open large and Download.
 * Preview opens inline, directly under its card and across the section; Preview again or ✕
 * closes it. Open large fills the panel itself, not the screen. Esc closes the innermost layer
 * first: Open large, then the preview, then the panel. Files are read only through `fileUrl`;
 * nothing opens a new tab or window, and nothing is downloaded to be viewed.
 */
export function SubmittalPanelAttachments({ locale, labels, files, fileUrl }: SubmittalPanelAttachmentsProps) {
  const id = useId();
  const { loads, load } = useAttachmentFiles(fileUrl);
  const [preview, setPreview] = useState<string | null>(null);
  const [large, setLarge] = useState<string | null>(null);
  const [previewPlace, setPreviewPlace] = useState(start);
  const [largePlace, setLargePlace] = useState(start);
  const cards = useRef(new Map<string, HTMLDivElement | null>());
  // The control Open large was opened from, which has the focus back when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const n = (value: number) => formatNumber(value, locale);
  const kindOf = (file: SubmittalPanelAttachmentFile) => attachmentKind(file.contentType);
  // A file no longer listed (the item read again) has no preview.
  const previewFile = files.find((f) => f.id === preview) ?? null;
  const largeFile = files.find((f) => f.id === large) ?? null;
  const previewIdOf = (fileId: string) => `${id}-${fileId}`;
  /** A card's first button: Preview, or Download for a file with no preview. */
  const focusCard = (fileId: string) => cards.current.get(fileId)?.querySelector("button")?.focus();

  const openPreview = (file: SubmittalPanelAttachmentFile) => {
    setPreview(file.id);
    setPreviewPlace(start);
    void load(file.id, kindOf(file));
  };
  const closePreview = () => {
    if (!preview) return;
    // The focus goes back to the card only from the preview itself (it is about to go), never from elsewhere in the panel.
    const focus = document.activeElement;
    const fromPreview = !focus || focus === document.body || document.getElementById(previewIdOf(preview))?.contains(focus);
    setPreview(null);
    if (fromPreview) focusCard(preview);
  };
  const openLarge = (file: SubmittalPanelAttachmentFile, from?: HTMLElement | null) => {
    if (large === null) opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setLarge(file.id);
    setLargePlace(start);
    void load(file.id, kindOf(file));
  };
  const closeLarge = () => {
    const from = large;
    setLarge(null);
    if (opener.current?.isConnected) opener.current.focus();
    else if (from) focusCard(from);
  };
  const download = async (file: SubmittalPanelAttachmentFile) => {
    const read = await load(file.id, kindOf(file));
    if (read) saveAttachment(read, file.name);
  };
  const print = async (file: SubmittalPanelAttachmentFile) => {
    const read = await load(file.id, kindOf(file));
    if (read) printAttachment(read);
  };
  const retry = (file: SubmittalPanelAttachmentFile) => void load(file.id, kindOf(file));

  // Esc closes Open large, else the preview, before the panel: taken first (the capture phase),
  // so the panel's own listener sees it taken. Another layer open (a menu, the number card) is first.
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector(otherLayer)) return;
    // Esc in a field being typed in is the field's, as the panel has it.
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && (focus.isContentEditable || focus.matches("input, textarea, select"))) return;
    const layer = attachmentLayerToClose({ large: largeFile?.id ?? null, preview: previewFile?.id ?? null });
    if (!layer) return;
    event.preventDefault();
    if (layer === "large") closeLarge();
    else closePreview();
  });
  const anyOpen = previewFile !== null || largeFile !== null;
  useEffect(() => {
    if (!anyOpen) return;
    const listener = (event: KeyboardEvent) => onEscape(event);
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [anyOpen]);

  if (files.length === 0) return <p className="text-[13px] text-muted">{labels.none}</p>;

  const meta = (file: SubmittalPanelAttachmentFile, fileLoad: AttachmentLoad | undefined) => {
    const pages = fileLoad?.status === "ready" ? fileLoad.file.pdf?.pages : undefined;
    return [labels.kind[kindOf(file)], ...(pages === undefined ? [] : [labels.pageCount(n(pages), pages)]), file.size].join(" · ");
  };

  return (
    <>
      <div className="sdp-att-files grid grid-cols-1 gap-2 @[560px]/sdp:grid-cols-2 @[880px]/sdp:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {files.map((file) => {
          const kind = kindOf(file);
          const viewable = kind !== "other";
          const open = previewFile?.id === file.id;
          const previewId = previewIdOf(file.id);
          const fileLoad = loads[file.id];
          // A click on the card's own space opens or closes its preview, as the design's; its buttons say what they do.
          const onCard = (event: MouseEvent) => {
            if (!viewable || (event.target as Element).closest("button")) return;
            if (open) closePreview();
            else openPreview(file);
          };
          return (
            <Fragment key={file.id}>
              <div
                ref={(row) => {
                  cards.current.set(file.id, row);
                }}
                data-attachment={file.id}
                data-active={open || undefined}
                onClick={onCard}
                className={cn(
                  "flex min-w-0 items-center gap-2.5 rounded-[10px] bg-surface px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--border-subtle)]",
                  viewable && "cursor-pointer",
                  open && "bg-brand-tint shadow-[inset_0_0_0_1.5px_var(--brand)]",
                )}
              >
                <AttachmentTile kind={kind} className="h-10 w-[34px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">
                    <bdi dir="ltr">{file.name}</bdi>
                  </p>
                  {/* A Download or Print that couldn't read the file says so here; an open preview says it itself. */}
                  {fileLoad?.status === "failed" && !open ? (
                    <p role="alert" className="truncate text-[11.5px] text-danger-fg">
                      {labels.unavailable}
                    </p>
                  ) : (
                    <p className="truncate text-[11.5px] text-muted">{meta(file, fileLoad)}</p>
                  )}
                </div>
                {viewable && (
                  <IconButton
                    size="sm"
                    label={labels.preview}
                    aria-expanded={open}
                    aria-controls={open ? previewId : undefined}
                    onClick={() => (open ? closePreview() : openPreview(file))}
                    className="shrink-0"
                  >
                    <Icon name="eye" size={16} />
                  </IconButton>
                )}
                {viewable && (
                  <IconButton size="sm" label={labels.openLarge} onClick={(event) => openLarge(file, event.currentTarget)} className="shrink-0">
                    <Icon name="external-link" size={16} />
                  </IconButton>
                )}
                <IconButton size="sm" label={labels.download} onClick={() => void download(file)} className="shrink-0">
                  <Icon name="download" size={16} />
                </IconButton>
              </div>
              {open && (
                <section id={previewId} aria-label={file.name} data-attachment-preview={file.id} className="col-span-full overflow-hidden rounded-[12px] bg-inverse text-on-inverse">
                  <div className="flex h-11 min-w-0 items-center gap-1 border-b border-on-inverse/10 ps-3 pe-1.5 text-[12.5px]">
                    <Icon name={attachmentIcon[kind]} size={16} className="shrink-0" />
                    <b className="min-w-0 truncate ps-1 font-semibold">
                      <bdi dir="ltr">{file.name}</bdi>
                    </b>
                    {/* The page and the zoom from the Normal band up; Compact scrolls (`drawer.css`), Open large has both. */}
                    {fileLoad?.status === "ready" && fileLoad.file.pdf && (
                      <span className="ms-1.5 hidden h-6 shrink-0 items-center rounded-full bg-on-inverse/10 px-2 text-[11.5px] font-semibold tabular-nums @[560px]/sdp:inline-flex">
                        <bdi dir="ltr">{labels.pageOf(n(previewPlace.page), n(fileLoad.file.pdf.pages))}</bdi>
                      </span>
                    )}
                    <span className="hidden shrink-0 items-center @[560px]/sdp:flex">
                      <IconButton size="sm" label={labels.zoomOut} className={onBar} onClick={() => setPreviewPlace((p) => ({ ...p, zoom: attachmentZoom(p.zoom, -attachmentZoomStep.preview) }))}>
                        <Icon name="zoom-out" size={16} />
                      </IconButton>
                      <span className="min-w-10 text-center tabular-nums">
                        <bdi dir="ltr">{n(previewPlace.zoom)}%</bdi>
                      </span>
                      <IconButton size="sm" label={labels.zoomIn} className={onBar} onClick={() => setPreviewPlace((p) => ({ ...p, zoom: attachmentZoom(p.zoom, attachmentZoomStep.preview) }))}>
                        <Icon name="zoom-in" size={16} />
                      </IconButton>
                    </span>
                    <span className="flex-1" />
                    <IconButton size="sm" label={labels.openLarge} className={cn(onBar, "shrink-0")} onClick={(event) => openLarge(file, event.currentTarget)}>
                      <Icon name="external-link" size={16} />
                    </IconButton>
                    <IconButton size="sm" label={labels.download} className={cn(onBar, "shrink-0")} onClick={() => void download(file)}>
                      <Icon name="download" size={16} />
                    </IconButton>
                    <IconButton size="sm" label={labels.print} className={cn(onBar, "shrink-0")} onClick={() => void print(file)}>
                      <Icon name="printer" size={16} />
                    </IconButton>
                    <IconButton size="sm" label={labels.closePreview} className={cn(onBar, "shrink-0")} onClick={closePreview}>
                      <Icon name="x" size={16} />
                    </IconButton>
                  </div>
                  <div className="flex h-[360px] min-w-0 @[560px]/sdp:h-[440px] @[880px]/sdp:h-[560px]">
                    <AttachmentView
                      locale={locale}
                      labels={labels}
                      name={file.name}
                      kind={kind}
                      load={fileLoad}
                      onRetry={() => retry(file)}
                      zoom={previewPlace.zoom}
                      onPage={(page) => setPreviewPlace((p) => ({ ...p, page }))}
                      jump={previewPlace.jump}
                      thumbnails
                    />
                  </div>
                </section>
              )}
            </Fragment>
          );
        })}
      </div>
      {largeFile && (
        <SubmittalPanelAttachmentViewer
          locale={locale}
          labels={labels}
          files={files}
          file={largeFile}
          load={loads[largeFile.id]}
          place={largePlace}
          onPlace={setLargePlace}
          onFile={(file) => openLarge(file)}
          onRetry={() => retry(largeFile)}
          onDownload={() => void download(largeFile)}
          onClose={closeLarge}
        />
      )}
    </>
  );
}

