"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SubmittalPanelAttachmentKind } from "./attachments-model.ts";
import { openPdf, type LoadedPdf } from "./pdf-loader.ts";

/** A file read into this page: its bytes as a same-origin URL, and a PDF opened with pdf.js (null if it can't be). */
export type LoadedAttachment = { url: string; pdf: LoadedPdf | null };

export type AttachmentLoad = { status: "loading" } | { status: "ready"; file: LoadedAttachment } | { status: "failed" };

/**
 * Reads the Attachments' files, each once, only through the URL `fileUrl` hands out (the api's
 * short-lived signed download URL, issued after its access check): a file the viewer may not see
 * gets the api's 404, so it fails and nothing is shown. The bytes are read whole and kept, so the
 * preview, Open large, Download and Print all use the one read, and nothing is asked of the file
 * store once the URL has expired. A failed read is tried again by asking once more.
 */
export function useAttachmentFiles(fileUrl: (id: string) => Promise<string>) {
  const [loads, setLoads] = useState<Readonly<Record<string, AttachmentLoad>>>({});
  const reads = useRef(new Map<string, Promise<LoadedAttachment | null>>());
  const kept = useRef<LoadedAttachment[]>([]);
  const gone = useRef(false);

  useEffect(() => {
    gone.current = false;
    const files = kept.current;
    return () => {
      gone.current = true;
      for (const file of files.splice(0)) {
        file.pdf?.destroy();
        URL.revokeObjectURL(file.url);
      }
      reads.current.clear();
    };
  }, []);

  const load = useCallback(
    (id: string, kind: SubmittalPanelAttachmentKind): Promise<LoadedAttachment | null> => {
      const started = reads.current.get(id);
      if (started) return started;
      const set = (load: AttachmentLoad) => {
        if (!gone.current) setLoads((all) => ({ ...all, [id]: load }));
      };
      set({ status: "loading" });
      const read = (async () => {
        try {
          const res = await fetch(await fileUrl(id));
          if (!res.ok) throw new Error(`file read answered ${res.status}`);
          const blob = await res.blob();
          // A PDF pdf.js can't open (damaged, or locked with a password) is still read: Download and Print have it.
          const pdf = kind === "pdf" ? await openPdf(await blob.arrayBuffer()).catch(() => null) : null;
          const file = { url: URL.createObjectURL(blob), pdf };
          if (gone.current) {
            pdf?.destroy();
            URL.revokeObjectURL(file.url);
            return null;
          }
          kept.current.push(file);
          set({ status: "ready", file });
          return file;
        } catch {
          reads.current.delete(id);
          set({ status: "failed" });
          return null;
        }
      })();
      reads.current.set(id, read);
      return read;
    },
    [fileUrl],
  );

  return { loads, load };
}

/** Saves a file read into this page under its name: the browser's download, no page opened. */
export function saveAttachment(file: LoadedAttachment, name: string) {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Prints a file read into this page from a hidden frame: the browser's print dialog, no new tab or window. */
export function printAttachment(file: LoadedAttachment) {
  document.querySelector("iframe[data-attachment-print]")?.remove();
  const frame = document.createElement("iframe");
  frame.dataset.attachmentPrint = "";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Laid out (a frame with display: none prints nothing) but out of sight.
  frame.style.cssText = "position: fixed; inset-inline-start: 0; bottom: 0; width: 0; height: 0; border: 0; visibility: hidden;";
  frame.addEventListener("load", () => frame.contentWindow?.print(), { once: true });
  frame.src = file.url;
  document.body.append(frame);
}
