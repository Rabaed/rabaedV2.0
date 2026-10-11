"use client";

import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Sheet, SheetContent, SheetTrigger } from "../overlay/sheet.tsx";
import { Sidebar, SidebarNav, type SidebarProps } from "./sidebar.tsx";

export type TopBarProps = {
  /** A button opening the navigation on a phone; AppShell supplies it. */
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

/** The bar across the top of the page (the banner landmark): the page's title at the start, then search; notifications and the Member's menu at the end. */
export function TopBar({ menu, title, search, notifications, member, className }: TopBarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-18 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:gap-4 sm:px-7",
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
  /** The sidebar: its brand, sections and labels. On a phone the same navigation opens in a sheet. */
  sidebar: SidebarProps;
  /** The top bar's slots. */
  topBar: Omit<TopBarProps, "menu" | "className">;
  /** The phone menu button's name, e.g. "Menu", and the sheet's close button's, e.g. "Close". */
  menuLabel: string;
  closeLabel: string;
  /** Under the top bar: e.g. a Project's `TabsBar`, then the page in `PageContent`. */
  children: ReactNode;
};

/**
 * The Rabaed layout every page sits in: the sidebar on the inline-start side
 * (the right in Arabic), and the top bar and page beside it. Below `lg` (1024px)
 * the sidebar becomes a sheet, opened from a menu button in the top bar.
 * Presentational only: navigation targets and data come from props.
 */
export function AppShell({ sidebar, topBar, menuLabel, closeLabel, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The navigation itself, for the phone sheet; the other props concern the desktop sidebar only.
  const { label, sections, current, linkAs, onNavigate } = sidebar;
  const nav = { label, sections, current, linkAs };
  const menu = (
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <SheetTrigger asChild>
        <IconButton label={menuLabel} className="lg:hidden">
          <Icon name="menu" />
        </IconButton>
      </SheetTrigger>
      <SheetContent
        side="start"
        title={sidebar.brand}
        closeLabel={closeLabel}
        // The phone's navigation is the sidebar: dark in every theme and mode, as on a wide screen.
        className="max-w-xs border-sidebar-border bg-sidebar p-4 text-sidebar-text"
        closeClassName="text-sidebar-icon hover:bg-sidebar-hover hover:text-sidebar-current-text active:bg-sidebar-press"
      >
        <SidebarNav
          {...nav}
          onNavigate={() => {
            setMenuOpen(false);
            onNavigate?.();
          }}
        />
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="flex min-h-dvh bg-canvas text-text">
      <Sidebar {...sidebar} className={cn("hidden lg:flex", sidebar.className)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar menu={menu} {...topBar} />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
