// How the boards scroll at tablet and phone widths (RP-1274, RP-1158 rows 48, 49 and 67): the Submittals
// Kanban, the Snag list board and the Packages board. Above 1024 nothing here applies, and each board
// scrolls down and sideways as one, its columns growing with their cards (RP-1092).

/**
 * The board's region. At 1024 and below it scrolls sideways only, snapping to each column's start in
 * the reading direction, and leaves scrolling down to its columns. A size container, so a phone column
 * can be the board's width less 40 px. While a card is dragged on touch (`data-touch-drag`) the snap is
 * off, so the board can scroll smoothly at its edges.
 */
export const boardScroller = "@container tablet:overflow-y-hidden tablet:snap-x tablet:snap-mandatory data-touch-drag:snap-none";

/** With `boardScroller`, a region whose columns sit in a row of their own (`boardRow`): that row gets its height. */
export const boardOfRow = "tablet:flex tablet:flex-col";

/** The row of columns inside such a region: the board's height at 1024 and below, so a column can be at most that. */
export const boardRow = "tablet:min-h-0 tablet:flex-1";

/**
 * A column. At 1024 and below it snaps by its start and is at most the board's height; on a phone it is
 * the board's width less 40 px, so the next column peeks at the end.
 */
export const boardColumn = "tablet:max-h-full tablet:min-h-0 tablet:snap-start phone:w-[calc(100cqw-40px)]";

/**
 * A column's cards, under its header: at 1024 and below they scroll up and down inside the column. Positioned,
 * so what a card places absolutely (its screen-reader text) scrolls and clips with it, not with the board.
 */
export const columnCards = "tablet:relative tablet:min-h-0 tablet:overflow-y-auto tablet:overscroll-y-contain";
