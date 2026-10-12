import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export type TitledCardProps = {
  /** The card's name, in its heading. */
  title: ReactNode;
  /** The heading's level in the page's outline. */
  level?: 2 | 3;
  /** Links or a figure at the end of the heading row. */
  actions?: ReactNode;
  children: ReactNode;
  /** `article` for one of a set of like cards (a Dashboard Type card), else `section`. */
  as?: "section" | "article";
  className?: string;
  /** The body's padding: the kit's 18 x 20px unless a card lays out its own rows. */
  bodyClassName?: string;
  "data-testid"?: string;
};

/**
 * The design kit's card (`.pc`): a 49px heading row, ruled off, with any links
 * at its end, over a padded body. Fills its grid cell's height. Home's cards,
 * the Dashboard's Type cards and the Project page's facts share it (RP-411).
 */
export function TitledCard({ title, level = 2, actions, children, as: Root = "section", className, bodyClassName = "px-5 py-[18px]", ...rest }: TitledCardProps) {
  const titleId = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Root aria-labelledby={titleId} className={cn("flex h-full min-w-0 flex-col rounded-lg border border-border bg-surface", className)} {...rest}>
      <header className="flex min-h-[49px] flex-wrap items-center gap-x-2.5 border-b border-border-subtle px-5 py-1.5">
        <Heading id={titleId} className="text-[16px] leading-tight font-bold">
          {title}
        </Heading>
        {actions && <div className="ms-auto flex items-center gap-1">{actions}</div>}
      </header>
      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>
    </Root>
  );
}
