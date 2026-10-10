import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { TableCard } from "../list/table-card.tsx";

// The Members page's card (kit `RP.users`, RP-413): the search box at its top,
// then one row per Member: avatar, name and email; their marks; how many
// Projects; their status; the row's menu. Presentational: the page words
// everything, filters the rows and owns the menu's commands.

export type MemberStatus = "invited" | "active" | "locked" | "deactivated";

export type MemberRow = {
  id: string;
  /** In the page's language. */
  name: string;
  email: string;
  /** The same for a Member in every language and session, so their colour never changes (their id). */
  colourKey: string;
  /** "Authorized Person", "Project Creator", as words; none for a plain Member. */
  marks: string[];
  /** The Projects they are on, written for the locale; null where the viewer may not read it. */
  projects: string | null;
  status: MemberStatus;
  statusLabel: string;
  /** The row's menu (`RowMenu`), for the Authorized Person. */
  menu?: ReactNode;
};

export type MembersCardLabels = {
  /** Names the table, e.g. "Members". */
  table: string;
  name: string;
  /** The marks column, e.g. "Role". */
  marks: string;
  projects: string;
  status: string;
  /** The menu column's hidden heading, e.g. "Actions". */
  actions: string;
  /** Shown where a Member has no mark or a count may not be read. */
  none: string;
};

export type MembersCardProps = {
  rows: MemberRow[];
  labels: MembersCardLabels;
  /** The card's top: `ToolbarSearch`. */
  search: ReactNode;
  /** Whether any row has a menu: the last column exists only then. */
  hasMenu?: boolean;
  /** Under the search box instead of the table, e.g. "No matching Members". */
  empty?: ReactNode;
};

// Kit pills: green Active, violet Invited, amber Locked, grey Deactivated.
const statusClasses: Record<MemberStatus, string> = {
  active: "bg-success-tint text-success-fg",
  invited: "bg-segment-type-tint text-segment-type-fg",
  locked: "bg-warning-tint text-warning-fg",
  deactivated: "bg-neutral-tint text-neutral-fg",
};

// The menu column stays at the row's end while the table scrolls sideways (on a phone), as the List's last column.
const pinned = "sticky end-0 max-sm:border-s max-sm:border-border-subtle";

const head = "h-auto px-5 py-3";
// The kit's 70px row: 36px avatar and 15px above and below, plus the line.
const cell = "h-auto px-5 py-[15px]";

/** The Members card: search on top, the table below, one 70px row per Member. */
export function MembersCard({ rows, labels, search, hasMenu = false, empty }: MembersCardProps) {
  return (
    <TableCard className="rounded-lg">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border-subtle px-5 py-[14px]">{search}</div>
      {empty ?? (
        <Table label={labels.table} data-testid="members" className="text-body">
          <TableHeader>
            <TableRow>
              <TableHead className={head}>{labels.name}</TableHead>
              <TableHead className={head}>{labels.marks}</TableHead>
              <TableHead className={head}>{labels.projects}</TableHead>
              <TableHead className={head}>{labels.status}</TableHead>
              {hasMenu && (
                <TableHead className={cn(head, pinned, "bg-surface-subtle")}>
                  <span className="sr-only">{labels.actions}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="group/row">
                <TableCell className={cell}>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={row.name} solidFrom={row.colourKey} decorative className="size-9 text-body" />
                    <div className="min-w-0">
                      <div className="font-semibold text-text">{row.name}</div>
                      <bdi dir="ltr" className="block text-[12.5px] text-muted">
                        {row.email}
                      </bdi>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cell}>
                  {row.marks.length === 0 ? (
                    <span className="text-muted">{labels.none}</span>
                  ) : (
                    <ul className="flex items-center gap-x-2 whitespace-nowrap text-text">
                      {row.marks.map((mark, at) => (
                        <li key={mark} className="flex items-center gap-2">
                          {at > 0 && (
                            <span aria-hidden="true" className="text-faint">
                              ·
                            </span>
                          )}
                          {mark}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className={cn(cell, "tabular-nums")}>
                  {row.projects ?? <span className="text-muted">{labels.none}</span>}
                </TableCell>
                <TableCell className={cell}>
                  <span
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 rounded-sm px-2.5 text-caption font-semibold whitespace-nowrap",
                      statusClasses[row.status],
                    )}
                  >
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
                    {row.statusLabel}
                  </span>
                </TableCell>
                {hasMenu && (
                  <TableCell className={cn(cell, pinned, "w-px bg-surface text-end group-hover/row:bg-hover")}>
                    {row.menu}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
