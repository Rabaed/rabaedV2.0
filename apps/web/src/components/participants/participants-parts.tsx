import type { DimensionKind, DimensionValue, DimensionValues, Locale } from "@rabaed/domain";
import { Icon, buttonVariants, cn, type IconName } from "@rabaed/ui";
import type { ReactNode } from "react";
import { PageBackLink } from "@/components/page-back-link";
import { Link } from "@/i18n/navigation";

// The parts the three Participants pages share (RP-1155, the owner's reference).

/** A link drawn as the kit's small outlined button (the reference's `.nbtn`). */
export const outlined = cn(buttonVariants({ variant: "ghost", size: "sm" }), "border border-border font-semibold");

/** A Dialog's classes that make it a bottom sheet at phone width (gap row 35, the reference's `.amod.ph`). */
export const sheetOnPhone =
  "max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:mx-0 max-sm:mb-0 max-sm:w-full max-sm:max-h-[85dvh] max-sm:rounded-b-none";

/** "Tower 1 › " before a Location's own name, muted (the reference's `.pth`). */
export function PathLabel({ value, byId, locale }: { value: DimensionValue; byId: ReadonlyMap<string, DimensionValue>; locale: Locale }) {
  const path = valuePath(value, byId, locale);
  const own = value.name[locale];
  const before = path.slice(0, path.length - own.length);
  return (
    <>
      {before && <span className="text-muted">{before}</span>}
      {own}
    </>
  );
}

export type Crumb = { label: string; href?: string };

/**
 * "My Company › Participants › Project › Member · Visibility"; the last crumb is the page itself.
 * On an inner page, "Back" above it (RP-1241), `back` being the page's fixed parent.
 */
export function ParticipantsBreadcrumb({ label, crumbs, back }: { label: string; crumbs: Crumb[]; back?: string }) {
  const nav = (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="flex items-center gap-1.5">
              {c.href && !last ? (
                <Link href={c.href} className="font-medium hover:text-text hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className={last ? "font-semibold text-text" : "font-medium"} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <Icon name="chevron-right" size={14} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
  if (back === undefined) return nav;
  return (
    <div className="flex flex-col gap-2">
      <PageBackLink parent={back} />
      {nav}
    </div>
  );
}

/** The heading, its one-line description and the actions at the end of the row. */
export function ParticipantsHeading({ title, description, actions }: { title: ReactNode; description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl space-y-1">
        <h1 className="font-display text-h4 font-semibold text-text">{title}</h1>
        <p className="text-sm text-muted">{description}</p>
      </div>
      {actions}
    </div>
  );
}

/** The lock notice for a Member who is not their Company's Authorized Person (gap row 5). */
export function ReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-muted" data-testid="read-only-notice">
      <Icon name="lock" size={16} />
      {children}
    </p>
  );
}

/** An uppercase section heading with a count chip. */
export function SectionHeading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-muted">
      {title}
      <span className="rounded-full border border-border bg-surface px-1.5 text-xs font-medium tabular-nums text-text">{count}</span>
    </h2>
  );
}

const kindIcon: Record<DimensionKind, IconName> = { trade: "category", location: "map-pin" };

/** A value's name with its covered ancestors: "Tower 1 › Building A". */
export function valuePath(value: DimensionValue, byId: ReadonlyMap<string, DimensionValue>, locale: Locale): string {
  const names = [value.name[locale]];
  for (let p = value.parentId; p !== null; ) {
    const parent = byId.get(p);
    if (!parent) break;
    names.unshift(parent.name[locale]);
    p = parent.parentId;
  }
  return names.join(" › ");
}

/** The values of a gap worth naming: each one whose parent is not in it too (the parent names its subtree). */
function topOf(values: DimensionValue[]): DimensionValue[] {
  const ids = new Set(values.map((v) => v.id));
  return values.filter((v) => v.parentId === null || !ids.has(v.parentId));
}

/**
 * The Visibility Gap (gap row 18, V16): what the Company covers that none of its Project
 * Members do. Only its Authorized Person gets one; nothing shows when it is empty.
 */
export function VisibilityGapWarning({
  gap,
  covered,
  title,
  body,
  locale,
}: {
  gap: DimensionValues;
  covered: DimensionValues;
  title: string;
  body: string;
  locale: Locale;
}) {
  const kinds = (["trade", "location"] as const).filter((k) => gap[k].length > 0);
  if (kinds.length === 0) return null;
  return (
    <section className="flex gap-3 rounded-md border border-warning-tint bg-warning-tint px-4 py-3.5 text-warning-fg" aria-label={title} data-testid="visibility-gap">
      <Icon name="alert-triangle" size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-semibold text-text">{title}</p>
        <p className="text-sm">{body}</p>
        <ul className="flex flex-wrap gap-2 pt-1">
          {kinds.flatMap((kind) => {
            const byId = new Map(covered[kind].map((v) => [v.id, v]));
            return topOf(gap[kind]).map((v) => (
              <li key={v.id} className="flex items-center gap-1.5 rounded-sm bg-surface px-2 py-1 text-sm font-medium text-text">
                <Icon name={kindIcon[kind]} size={14} />
                {valuePath(v, byId, locale)}
              </li>
            ));
          })}
        </ul>
      </div>
    </section>
  );
}
