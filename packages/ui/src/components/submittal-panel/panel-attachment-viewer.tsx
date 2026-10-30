"use client";

import { formatNumber, type Locale } from "@rabaed/domain";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { onBar } from "../photo/photo-screen.tsx";
import type { AttachmentLoad } from "./attachment-files.ts";
import { AttachmentTile, AttachmentView, attachmentIcon, attachmentNameClass } from "./attachment-view.tsx";
import { attachmentKind, attachmentZoom, attachmentZoomStep } from "./attachments-model.ts";
import type { AttachmentPlace, SubmittalPanelAttachmentFile, SubmittalPanelAttachmentsLabels } from "./panel-attachments.tsx";

export type SubmittalPanelAttachmentViewerProps = {
  locale: Locale;
  labels: SubmittalPanelAttachmentsLabels;
  files: readonly SubmittalPanelAttachmentFile[];
  file: SubmittalPanelAttachmentFile;
  load: AttachmentLoad | undefined;
  place: AttachmentPlace;
  onPlace: (place: AttachmentPlace) => void;
  /** Another file chosen in the switcher strip. */
  onFile: (file: SubmittalPanelAttachmentFile) => void;
  onRetry: () => void;
  onDownload: () => void;
  onClose: () => void;
};

const focusable = 'button:not([disabled]), [tabindex="0"]';

/**
 * Previous and Next page at the first or last page: marked unavailable rather than disabled, so the
 * focus stays on the button (a disabled one drops it out of the dialog), and drawn as a disabled one.
 */
const stayFocused = "aria-disabled:cursor-default aria-disabled:bg-transparent aria-disabled:text-on-inverse/40";

/**
 * Open large (RP-1068, README §7): the file over the whole panel, not the screen, with "‹ Back",
 * the page and zoom controls (25% steps) and a strip to switch files. It is mounted inside the
 * panel, so it follows the panel's width and layout bands, and is a dialog layer the panel waits
 * for: Esc closes it first (the section's listener), and ↑ / ↓ don't move to another submittal.
 * The keyboard stays inside it until it closes.
 */
export function SubmittalPanelAttachmentViewer({ locale, labels, files, file, load, place, onPlace, onFile, onRetry, onDownload, onClose }: SubmittalPanelAttachmentViewerProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [panel, setPanel] = useState<Element | null>(null);
  useEffect(() => setPanel(anchor.current?.closest("[data-submittal-panel]") ?? document.body), []);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (panel) back.current?.focus();
  }, [panel]);

  const n = (value: number) => formatNumber(value, locale);
  const kind = attachmentKind(file.contentType);
  const pages = load?.status === "ready" ? (load.file.pdf?.pages ?? null) : null;
  const index = files.findIndex((f) => f.id === file.id);
  const goTo = (page: number) => onPlace({ ...place, page, jump: { page, seq: (place.jump?.seq ?? 0) + 1 } });
  const zoomBy = (delta: number) => onPlace({ ...place, zoom: attachmentZoom(place.zoom, delta) });

  // The keyboard focus goes round its own controls.
  const keepFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    // eslint-disable-next-line rabaed/no-avoid-terms -- the key's name, not copy
    if (event.key !== "Tab") return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>(focusable)];
    const first = all[0];
    const last = all.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const viewer = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      data-state="open"
      data-attachment-viewer=""
      onKeyDown={keepFocus}
      className="sdp-att-viewer absolute inset-0 z-30 flex flex-col bg-inverse text-on-inverse"
    >
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-on-inverse/10 px-2 @[560px]/sdp:gap-2 @[560px]/sdp:px-3">
        <Button ref={back} variant="ghost" size="sm" onClick={onClose} className={cn(onBar, "shrink-0 gap-1 px-2")}>
          <Icon name={locale === "ar" ? "chevron-right" : "chevron-left"} size={16} />
          {labels.back}
        </Button>
        <AttachmentTile kind={kind} className="hidden h-10 w-[34px] @[560px]/sdp:flex" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className={cn(attachmentNameClass, "text-[13px] font-semibold")}>{file.name}</p>
          <p className="truncate text-[11.5px] text-on-inverse/70">
            <bdi dir="ltr">{labels.pageOf(n(index + 1), n(files.length))}</bdi> {labels.ofAttachments(files.length)} · {file.size}
          </p>
        </div>
        {pages !== null && (
          <span className="flex shrink-0 items-center">
            <IconButton size="sm" label={labels.previousPage} aria-disabled={place.page <= 1 || undefined} className={cn(onBar, stayFocused)} onClick={() => place.page > 1 && goTo(place.page - 1)}>
              <Icon name="chevron-up" size={16} />
            </IconButton>
            <span className="min-w-10 text-center text-[12px] tabular-nums">
              <bdi dir="ltr">{labels.pageOf(n(place.page), n(pages))}</bdi>
            </span>
            <IconButton size="sm" label={labels.nextPage} aria-disabled={place.page >= pages || undefined} className={cn(onBar, stayFocused)} onClick={() => place.page < pages && goTo(place.page + 1)}>
              <Icon name="chevron-down" size={16} />
            </IconButton>
          </span>
        )}
        {kind !== "other" && (
          <span className="flex shrink-0 items-center">
            <IconButton size="sm" label={labels.zoomOut} className={onBar} onClick={() => zoomBy(-attachmentZoomStep.large)}>
              <Icon name="zoom-out" size={16} />
            </IconButton>
            <span className="min-w-10 text-center text-[12px] tabular-nums">
              <bdi dir="ltr">{n(place.zoom)}%</bdi>
            </span>
            <IconButton size="sm" label={labels.zoomIn} className={onBar} onClick={() => zoomBy(attachmentZoomStep.large)}>
              <Icon name="zoom-in" size={16} />
            </IconButton>
          </span>
        )}
        <IconButton size="sm" label={labels.download} className={cn(onBar, "shrink-0")} onClick={onDownload}>
          <Icon name="download" size={16} />
        </IconButton>
        <IconButton size="sm" label={labels.close} className={cn(onBar, "shrink-0")} onClick={onClose}>
          <Icon name="x" size={16} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1">
        <AttachmentView
          key={file.id}
          locale={locale}
          labels={labels}
          name={file.name}
          kind={kind}
          load={load}
          onRetry={onRetry}
          zoom={place.zoom}
          onPage={(page) => onPlace({ ...place, page })}
          jump={place.jump}
        />
      </div>
      <div role="group" aria-label={labels.files} className="flex shrink-0 gap-2 overflow-x-auto border-t border-on-inverse/10 p-2.5">
        {files.map((f) => {
          const current = f.id === file.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-current={current || undefined}
              onClick={() => !current && onFile(f)}
              className={cn(
                "flex h-[38px] max-w-[240px] shrink-0 items-center gap-2 rounded-[9px] px-3 text-[12.5px] font-semibold",
                focusRing,
                current ? "bg-on-inverse text-inverse" : "bg-on-inverse/10 hover:bg-on-inverse/20",
              )}
            >
              <Icon name={attachmentIcon[attachmentKind(f.contentType)]} size={16} className="shrink-0" />
              <bdi dir="ltr" className="truncate">
                {f.name}
              </bdi>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <span ref={anchor} hidden />
      {panel && createPortal(viewer, panel)}
    </>
  );
}
