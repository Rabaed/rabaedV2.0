"use client";

import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { useHideOnScroll } from "../../lib/use-hide-on-scroll.ts";
import { useMediaQuery } from "../../lib/use-media-query.ts";
import { PHONE } from "../../lib/widths.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Sheet, SheetContent, SheetTrigger } from "../overlay/sheet.tsx";
import { ActionBarContext } from "./action-bar.tsx";
import { Sidebar, SidebarNav, type SidebarProps } from "./sidebar.tsx";

export type TopBarProps = {
  /** A button opening the navigation up to the tablet width; AppShell supplies it. */
  menu?: ReactNode;
  /** The page's title at the start, e.g. `TopBarTitle`: a page name, or a Project's name and Host Company. */
  title?: ReactNode;
  /** The search entry, e.g. a button that opens search. */
  search?: ReactNode;
  /** The notifications button. */
  notifications?: ReactNode;
  /** The MemberMenu. */
  member?: ReactNode;
  className?: string;
};

/**
 * The bar across the top of the page (the banner landmark): the page's title at the start, then search;
 * notifications and the Member's menu at the end. 72 high, 56 on a phone (RP-1272).
 */
export function TopBar({ menu, title, search, notifications, member, className }: TopBarProps) {
  return (
    <header
      className={cn(
        "flex h-18 shrink-0 items-center gap-4 border-b border-border bg-surface px-7 tablet:px-4 phone:h-14 phone:gap-2",
        className,
      )}
    >
      {menu}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {title !== undefined && <div className="min-w-0 flex-1">{title}</div>}
        {search}
      </div>
      {notifications}
      {member}
    </header>
  );
}

export type AppShellProps = {
  /** The sidebar: its brand, sections, labels and Member block. Up to the tablet width the same opens in a drawer. */
  sidebar: SidebarProps;
  /** The top bar's slots. */
  topBar: Omit<TopBarProps, "menu" | "className">;
  /** The band under the top bar, e.g. a Project's `TabsBar`. On a phone it stays (and hides) with the top bar; wider, it scrolls with the page. */
  tabs?: ReactNode;
  /** The menu button's name, e.g. "Menu", and the drawer's close button's, e.g. "Close". */
  menuLabel: string;
  closeLabel: string;
  /** The page, e.g. in `PageContent`. */
  children: ReactNode;
};

/**
 * The Rabaed layout every page sits in: the sidebar on the inline-start side (the right in Arabic), and the
 * top bar and page beside it. Up to and including the tablet width (1024, `TABLET`) the sidebar is a drawer,
 * opened from a menu button in the top bar. On a phone (`PHONE`) the top bar and tabs hide as the page
 * scrolls down and come back as it scrolls up, and a bar at the bottom holds the page's `PrimaryAction`.
 * Presentational only: navigation targets and data come from props.
 */
export function AppShell({ sidebar, topBar, tabs, menuLabel, closeLabel, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isPhone = useMediaQuery(PHONE, false);
  const [barsHidden, showBars] = useHideOnScroll(isPhone);
  const [actionBar, setActionBar] = useState<HTMLElement | null>(null);
  // The navigation itself, for the drawer; the collapse props concern the desktop sidebar only.
  const { label, sections, current, linkAs, onNavigate, footer } = sidebar;
  const nav = { label, sections, current, linkAs };
  const menu = (
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <SheetTrigger asChild>
        <IconButton label={menuLabel} className="hidden tablet:inline-flex">
          <Icon name="menu" />
        </IconButton>
      </SheetTrigger>
      <SheetContent
        side="start"
        title={sidebar.brand}
        closeLabel={closeLabel}
        // The drawer is the sidebar: dark in every theme and mode, as on a wide screen. 304 wide, never over 85% of the window.
        className="w-76 max-w-[85vw] border-sidebar-border bg-sidebar p-4 text-sidebar-text"
        closeClassName="text-sidebar-icon hover:bg-sidebar-hover hover:text-sidebar-current-text active:bg-sidebar-press"
      >
        <SidebarNav
          {...nav}
          onNavigate={() => {
            setMenuOpen(false);
            onNavigate?.();
          }}
        />
        {/* The Member at the bottom, as at the desktop sidebar's foot. */}
        {footer !== undefined && (
          <div className="mt-auto border-t border-sidebar-divider pt-3">{typeof footer === "function" ? footer(false) : footer}</div>
        )}
      </SheetContent>
    </Sheet>
  );

  return (
    // A page holding a board that fills the window (RP-1092) is the window's height: the page doesn't scroll, the board does.
    <div className="flex min-h-dvh bg-canvas text-text fills-window:h-dvh">
      <Sidebar {...sidebar} className={cn("tablet:hidden", sidebar.className)} />
      <div className="flex min-w-0 flex-1 flex-col fills-window:min-h-0">
        <div
          className={cn("sticky top-0 z-30 transition-transform duration-200 motion-reduce:transition-none", barsHidden && "-translate-y-full")}
          // Keyboard focus moving into hidden bars brings them back.
          onFocus={showBars}
        >
          <TopBar menu={menu} {...topBar} />
          {/* On a phone the tabs stay with the top bar, hiding and coming back with it (the Anatomy's sticky tabs row). */}
          {isPhone && tabs}
        </div>
        {/* On a tablet and desktop they scroll away with the page, as before. */}
        {!isPhone && tabs}
        <ActionBarContext.Provider value={{ bar: isPhone ? actionBar : null }}>
          <main className="flex min-w-0 flex-1 flex-col fills-window:min-h-0">{children}</main>
        </ActionBarContext.Provider>
        {isPhone && (
          <div
            ref={setActionBar}
            data-action-bar=""
            className="sticky bottom-0 z-20 border-t border-border bg-surface px-4 pt-3 empty:hidden"
            // Above Safari's toolbar and the home indicator.
            // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          />
        )}
      </div>
    </div>
  );
}
