"use client";

import { useEffect } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";

export type ListToastProps = {
  /** What just happened, e.g. "Exported 42 submittals (CSV)"; null shows nothing. */
  message: string | null;
  /** Called when it has been shown long enough. */
  onDone: () => void;
  /** How long it stays, in ms. */
  duration?: number;
};

/**
 * A list page's short confirmation (RP-409, the owner's design): a dark pill at the
 * bottom centre with a check, read out politely, gone after a moment.
 */
export function ListToast({ message, onDone, duration = 2600 }: ListToastProps) {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDone, duration);
    return () => clearTimeout(timer);
  }, [message, onDone, duration]);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      {message !== null && (
        <span className={cn("inline-flex min-h-10 items-center gap-2 rounded-sm bg-inverse px-4 py-2 text-sm font-semibold text-on-inverse shadow-lg")}>
          <Icon name="circle-check" size={17} className="shrink-0" />
          {message}
        </span>
      )}
    </div>
  );
}
