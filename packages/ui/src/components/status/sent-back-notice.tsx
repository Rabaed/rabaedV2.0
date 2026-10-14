import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { toneClasses } from "../data/tone.ts";
import { Icon } from "../icon/icon.tsx";

export type SentBackNoticeProps = {
  /** Why the Form is read-only, e.g. "Sent back for comment: reply and Submit it again." */
  children: ReactNode;
  className?: string;
};

/**
 * Above the raiser's read-only Form, for its own Members only: the item was Sent Back to a
 * Step that says "Comment only" (ADR 0021), so they reply with a comment and Submit it again.
 */
export function SentBackNotice({ children, className }: SentBackNoticeProps) {
  return (
    <p role="note" className={cn("m-0 flex items-start gap-2 rounded-lg px-3 py-2.5 text-body font-medium", toneClasses.info, className)}>
      <Icon name="message-circle" size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
