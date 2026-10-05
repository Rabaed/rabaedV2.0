import { changedByLabel, savedLabel, type Locale } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";

export type SaveStatusProps = {
  /** When the item was last saved (ISO); nothing is shown before the first save. */
  savedAt?: string | null;
  /** Fields another Member changed, which the last save kept as theirs. */
  changedByOthers?: readonly { fieldLabel: string; memberName: string }[];
  locale: Locale;
  className?: string;
};

/**
 * Beside the Save button: "Saved 10:15", and one line for each field another
 * Member changed meanwhile ("Description changed by Omar just now").
 */
export function SaveStatus({ savedAt, changedByOthers = [], locale, className }: SaveStatusProps) {
  if (!savedAt && changedByOthers.length === 0) return null;
  return (
    <div role="status" className={cn("space-y-1 text-body text-muted", className)}>
      {savedAt && <p data-saved="">{savedLabel(savedAt, locale)}</p>}
      {changedByOthers.map((c) => (
        <p key={c.fieldLabel} data-changed-by-other="" className="text-text">
          {changedByLabel(c.fieldLabel, c.memberName, locale)}
        </p>
      ))}
    </div>
  );
}
