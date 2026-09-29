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
  /** The search entry, e.g. a button that opens search. */
  search?: ReactNode;
  /** The notifications button. */
  notifications?: ReactNode;
  /** The UserMenu. */
  user?: ReactNode;
  className?: string;
};

/** The bar across the top of the page: search at the start; notifications and the user menu at the end. */
export function TopBar({ menu, search, notifications, user, className }: TopBarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6",
        className,
      )}
    >
      {menu}
      <div className="min-w-0 flex-1">{search}</div>
      {notifications}
      {user}
    </div>
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
  /** The page: usually a PageHeader, then the content. */
  children: ReactNode;
};

/**
 * The Rabaed layout every page sits in: the sidebar on the inline-start side
 * (the right in Arabic), and the top bar and page beside it. On a phone the
 * sidebar becomes a sheet, opened from a menu button in the top bar.
 * Presentational only: navigation targets and data come from props.
 */
export function AppShell({ sidebar, topBar, menuLabel, closeLabel, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = (
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <SheetTrigger asChild>
        <IconButton label={menuLabel} className="md:hidden">
          <Icon name="menu" />
        </IconButton>
      </SheetTrigger>
      <SheetContent side="start" title={sidebar.brand} closeLabel={closeLabel} className="max-w-xs p-4">
        <SidebarNav
          label={sidebar.label}
          sections={sidebar.sections}
          current={sidebar.current}
          linkAs={sidebar.linkAs}
          onNavigate={() => {
            setMenuOpen(false);
            sidebar.onNavigate?.();
          }}
        />
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="flex min-h-dvh bg-canvas text-text">
      <Sidebar {...sidebar} className={cn("hidden md:flex", sidebar.className)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar menu={menu} {...topBar} />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
