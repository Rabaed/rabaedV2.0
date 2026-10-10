"use client";

import type { BoardCardLayout, BoardCardLayoutChange, Locale, WorkItemBoard as WorkItemBoardData } from "@rabaed/domain";
import { useId, useMemo } from "react";
import { cn } from "../../lib/cn.ts";
import { Switch } from "../form/switch.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { toolbarButton } from "../list/list-toolbar.tsx";
import { KanbanCard } from "./kanban-card.tsx";
import { boardStages, cardContent, type WorkItemBoardLabels } from "./work-item-board.tsx";

/** The Card view layout menu's words, from the app's messages. */
export type BoardLayoutMenuLabels = {
  /** The button's and the menu's name, e.g. "Card view layout". */
  title: string;
  /** Beside the title, e.g. "Board settings". */
  boardSettings: string;
  /** The parts that can't be hidden, e.g. "Header, subject, tags, owner". */
  fixedParts: string;
  alwaysShown: string;
  contractorName: string;
  location: string;
  creationDate: string;
  /** Above the live preview, e.g. "Preview". */
  preview: string;
};

export type BoardLayoutMenuProps = {
  layout: BoardCardLayout;
  /** One switch changed: the board shows it at once, and the page keeps it for the viewer. */
  onChange: (change: BoardCardLayoutChange) => void;
  labels: BoardLayoutMenuLabels;
  /** The board, for the live preview of its first card; with the board's words for that card. */
  board?: WorkItemBoardData;
  boardLabels?: WorkItemBoardLabels;
  locale: Locale;
};

const rows: { key: keyof BoardCardLayout; icon: IconName }[] = [
  { key: "contractorName", icon: "briefcase" },
  { key: "location", icon: "map" },
  { key: "creationDate", icon: "calendar-event" },
];

/**
 * Card view layout (RP-410, the owner's Kanban Card Anatomy): the optional parts
 * of a card, switched by each Member for each board, with a live preview of a
 * card. Header, Subject, tags and owner are always shown.
 */
export function BoardLayoutMenu({ layout, onChange, labels, board, boardLabels, locale }: BoardLayoutMenuProps) {
  const id = useId();
  const sample = useMemo(() => {
    if (!board) return undefined;
    const shown = new Set(boardStages(board).map((s) => s.key));
    return board.columns.filter((c) => shown.has(c.stageKey)).flatMap((c) => c.lanes.flatMap((l) => l.cards))[0];
  }, [board]);
  const places = useMemo(() => {
    const byId = new Map((board?.filters.locations ?? []).map((l) => [l.id, l]));
    const out = new Map<string, { depth: number; name: { en: string; ar: string } }[]>();
    for (const l of byId.values()) {
      const path: { depth: number; name: { en: string; ar: string } }[] = [];
      for (let at: typeof l | undefined = l; at; at = at.parentId ? byId.get(at.parentId) : undefined) path.unshift({ depth: at.depth, name: at.name });
      out.set(l.id, path);
    }
    return out;
  }, [board]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={labels.title} title={labels.title} className={cn(toolbarButton, "px-2.5")}>
          <Icon name="layout-grid" />
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={`${id}-title`} align="end" className="w-[22.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md p-0 shadow-lg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Icon name="layout-grid" size={18} className="text-text-secondary" />
          <h2 id={`${id}-title`} className="text-body font-semibold text-text">
            {labels.title}
          </h2>
          <span className="ms-auto text-caption text-muted">{labels.boardSettings}</span>
        </div>
        <ul className="flex flex-col">
          <li className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-sm text-muted">
            <Icon name="lock" size={16} />
            <span className="min-w-0 flex-1">{labels.fixedParts}</span>
            <span className="text-notes">{labels.alwaysShown}</span>
          </li>
          {rows.map(({ key, icon }) => (
            <li key={key} className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-sm text-text-secondary last:border-b-0">
              <Icon name={icon} size={16} className="text-muted" />
              <label htmlFor={`${id}-${key}`} className="min-w-0 flex-1 cursor-pointer">
                {labels[key]}
              </label>
              <Switch id={`${id}-${key}`} checked={layout[key]} onCheckedChange={(on) => onChange({ [key]: on })} />
            </li>
          ))}
        </ul>
        {sample && board && boardLabels && (
          <div className="border-t border-border bg-canvas px-4 pt-2.5 pb-4">
            <p className="mb-2 text-caption font-semibold text-muted">{labels.preview}</p>
            <div aria-hidden="true" inert className="pointer-events-none">
              <KanbanCard {...cardContent(sample, locale, boardLabels, board.filters.outcomes, layout, places)} href="#" />
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
