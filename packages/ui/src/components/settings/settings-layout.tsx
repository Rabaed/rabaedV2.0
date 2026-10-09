"use client";

import { useId, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Field } from "../form/field.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

// The template of every Project Settings page (RP-412): a navigation of the
// settings pages on the inline-start side (the right in Arabic), and beside it
// the page's header and its section cards. Below `md` the navigation becomes a
// select at the top. Presentational; the app lists the pages and navigates.

export type SettingsNavItem = {
  key: string;
  label: string;
  icon: IconName;
  href: string;
};

export type SettingsNavProps = {
  /** The small heading over the items, e.g. "Project settings". It also names the navigation. */
  heading: string;
  items: SettingsNavItem[];
  /** The key of the page being shown. */
  current?: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** Below `md` the items are a select; choosing one calls this with its `href`. */
  onNavigate: (href: string) => void;
  className?: string;
};

/** The settings navigation: a card of links from `md` up, a select below it. */
export function SettingsNav({ heading, items, current, linkAs: Link = "a", onNavigate, className }: SettingsNavProps) {
  const headingId = useId();
  const currentItem = items.find((item) => item.key === current);
  return (
    <div className={cn("min-w-0 md:sticky md:top-6", className)}>
      <nav aria-labelledby={headingId} className="hidden flex-col gap-0.5 rounded-[14px] border border-border bg-surface p-2 md:flex">
        <h2 id={headingId} className="px-2.5 pt-2 pb-1.5 text-notes font-bold text-muted uppercase ltr:tracking-wider rtl:text-caption">
          {heading}
        </h2>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const isCurrent = item.key === current;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px]",
                    focusRing,
                    isCurrent ? "bg-brand-tint font-semibold text-brand-fg" : "text-text-secondary hover:bg-hover",
                  )}
                >
                  <Icon name={item.icon} size={17} className={isCurrent ? undefined : "text-muted"} />
                  <span className="min-w-0 flex-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="md:hidden">
        <Field label={heading} id={`${headingId}-select`}>
          {/* A native select (the page's value always shown, a phone opens its own picker), drawn as the kit's nav card: its icon, the current page in the brand tint. */}
          <span className="relative flex">
            {currentItem && (
              <Icon name={currentItem.icon} size={17} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-brand-fg" />
            )}
            <select
              id={`${headingId}-select`}
              className={cn(
                "h-11 w-full cursor-pointer appearance-none rounded-[14px] border border-border bg-surface ps-8 pe-8 text-[13.5px] font-semibold text-brand-fg",
                "hover:border-border-strong",
                focusRing,
              )}
              value={currentItem?.href ?? ""}
              onChange={(e) => onNavigate(e.target.value)}
            >
              {items.map((item) => (
                <option key={item.key} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size={16} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-muted" />
          </span>
        </Field>
      </div>
    </div>
  );
}

export type SettingsLayoutProps = {
  /** The `SettingsNav`. */
  nav: ReactNode;
  /** The page: a `SettingsHeader` and `SettingsSection`s. */
  children: ReactNode;
  className?: string;
};

/** The settings template: the navigation beside the page (above it below `md`), up to 1280px wide. */
export function SettingsLayout({ nav, children, className }: SettingsLayoutProps) {
  return (
    <div className={cn("grid max-w-7xl items-start gap-6 md:grid-cols-[14.5rem_minmax(0,1fr)]", className)}>
      {nav}
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

export type SettingsHeaderProps = {
  /** The page's one `h1`. */
  title: ReactNode;
  description?: ReactNode;
  /** Said when the Member may read this page but not change it, e.g. "Only Project Admins can change this". */
  readOnlyLabel?: ReactNode;
  /** Buttons at the end of the header. */
  actions?: ReactNode;
};

/** The top of a settings page: its title and a line about it, with the read-only note or actions at the end. */
export function SettingsHeader({ title, description, readOnlyLabel, actions }: SettingsHeaderProps) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-[22px] leading-tight font-bold text-text ltr:font-extrabold">{title}</h1>
        {description !== undefined && <p className="max-w-[640px] text-[13.5px] leading-normal text-muted">{description}</p>}
      </div>
      {(readOnlyLabel !== undefined || actions !== undefined) && (
        <div className="flex flex-wrap items-center gap-2.5 ms-auto">
          {readOnlyLabel !== undefined && (
            <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-neutral-tint px-2.5 py-[5px] text-[12.5px] font-semibold text-neutral-fg">
              <Icon name="lock" size={14} />
              {readOnlyLabel}
            </span>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

export type SettingsSectionProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** The card's `h2`. */
  title: ReactNode;
  description?: ReactNode;
  /** At the end of the card's header, e.g. a count or a button. */
  actions?: ReactNode;
  /** The body's padding, e.g. `px-0 pb-0` for a table edge to edge. */
  bodyClassName?: string;
};

/** One card of a settings page (kit `.card`): a header (title, a line about it, actions) and the card's body. */
export function SettingsSection({ title, description, actions, bodyClassName, children, className, ...rest }: SettingsSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("rounded-[14px] border border-border bg-surface", className)} {...rest}>
      <div className="flex items-start gap-3 px-5 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="text-[15.5px] font-bold text-text">
            {title}
          </h2>
          {description !== undefined && <p className="text-sm leading-normal text-muted">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2 ms-auto">{actions}</div>}
      </div>
      <div className={cn("flex flex-col gap-4 px-5 pt-4 pb-5", bodyClassName)}>{children}</div>
    </section>
  );
}
