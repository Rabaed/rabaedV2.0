"use client";

import { useId, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

/** The chips' words, from the app's messages. */
export type AttachmentChipsLabels = {
  /** "No Documents attached." */
  none: string;
  /** "Attach a Document": the holder's chip that picks a file. */
  attach: string;
  /** A chip's name for assistive technology: "Open Cover_letter.pdf". */
  open: (fileName: string) => string;
  /** Its remove button: "Remove Cover_letter.pdf". */
  remove: (fileName: string) => string;
};

export type AttachmentChip = {
  id: string;
  fileName: string;
  contentType: string;
  /** Submitted: it can't be removed any more (ADR 0020). */
  frozen: boolean;
};

export type AttachmentChipsProps = {
  labels: AttachmentChipsLabels;
  /** The item's Documents that belong to no Form field, as the API gives them to the viewer. */
  documents: readonly AttachmentChip[];
  /** The viewer may attach and remove now (the holder of a raiser's Step that edits the Form). */
  canChange: boolean;
  /** An upload or removal is under way. */
  pending?: boolean;
  /** The types the API takes, for the file picker. */
  accept: readonly string[];
  /** A line under the chips for the holder, e.g. the limits. */
  help?: string;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onAttach: (file: File) => void;
};

/**
 * The Work Item page's Attachments card (RP-1188, gap table row 50): one chip per Document, its type's
 * icon and its name, which opens it, with a remove button while the viewer may change them and it isn't
 * Submitted; then "Attach a Document" for the holder. Presentational: the page reads, opens, uploads
 * and removes.
 */
export function AttachmentChips({ labels: text, documents, canChange, pending = false, accept, help, onOpen, onRemove, onAttach }: AttachmentChipsProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const chip = "inline-flex h-9 max-w-full items-center gap-1.5 rounded-[10px] border border-border-subtle bg-surface text-[13px] font-semibold";
  return (
    <div className="flex flex-col gap-2">
      {documents.length === 0 && !canChange && <p className="text-sm text-muted">{text.none}</p>}
      <ul className="flex flex-wrap gap-2">
        {documents.map((d) => {
          const removable = canChange && !d.frozen;
          return (
            <li key={d.id} className={cn(chip, "ps-0", !removable && "pe-0")}>
              <button
                type="button"
                aria-label={text.open(d.fileName)}
                onClick={() => onOpen(d.id)}
                className={cn("inline-flex h-full min-w-0 items-center gap-1.5 rounded-[10px] px-3 hover:bg-hover", focusRing)}
              >
                <Icon name={iconOf(d.contentType)} size={16} className={cn("shrink-0", d.contentType === "application/pdf" ? "text-danger-fg" : "text-muted")} />
                <bdi className="truncate">{d.fileName}</bdi>
              </button>
              {removable && (
                <button
                  type="button"
                  aria-label={text.remove(d.fileName)}
                  disabled={pending}
                  onClick={() => onRemove(d.id)}
                  className={cn("me-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-text disabled:opacity-50", focusRing)}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          );
        })}
        {canChange && (
          <li>
            <label htmlFor={inputId} className={cn(chip, "cursor-pointer px-3 font-medium hover:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus", pending && "pointer-events-none opacity-60")}>
              <Icon name="paperclip" size={16} className="shrink-0" />
              {text.attach}
            </label>
            <input
              ref={input}
              id={inputId}
              type="file"
              className="sr-only"
              accept={accept.join(",")}
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAttach(file);
                if (input.current) input.current.value = "";
              }}
            />
          </li>
        )}
      </ul>
      {canChange && help && <p className="text-[12px] text-muted">{help}</p>}
    </div>
  );
}

function iconOf(contentType: string) {
  if (contentType.startsWith("image/")) return "photo" as const;
  return "file-text" as const;
}
