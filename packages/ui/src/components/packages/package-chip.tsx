import type { ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

// The Package chip (RP-659, spec RP-616 story 36): `PKG-004 · Bathrooms – Tower 1` on a
// submittal's card and on its page, opening the Package. Presentational: the caller shows it
// only where the API gives the item's Package, which it does only where the viewer sees the
// Package (visibility.md "Packages"), so an Open Package never shows on another Company's item.

export type PackageChipProps = {
  /** `PKG-004`: left to right, in Arabic too. */
  number: string;
  /** The Package's name in the viewer's language. */
  name: string;
  /** The Package's page. */
  href: string;
  /** The link's accessible name, e.g. "Open Package PKG-004 Bathrooms – Tower 1". */
  label: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  className?: string;
};

export function PackageChip({ number, name, href, label, linkAs: Link = "a", className }: PackageChipProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      data-package-chip=""
      className={cn(
        "relative z-10 inline-flex h-[22px] max-w-full min-w-0 items-center gap-1 rounded-[6px] bg-brand-tint px-2 text-caption font-semibold text-brand-fg hover:underline",
        focusRing,
        touchBox,
        className,
      )}
    >
      <Icon name="packages" size={13} />
      <bdi dir="ltr" translate="no" className="shrink-0 font-ui">
        {number}
      </bdi>
      <span aria-hidden="true">·</span>
      <span className="truncate">{name}</span>
    </Link>
  );
}
