"use client";

import { DirectionProvider as RadixDirectionProvider } from "@radix-ui/react-direction";

/**
 * Tells interactive components (radio groups, segmented controls, select
 * menus) the reading direction, for arrow keys and menu placement. Wrap the
 * app once, with `dir` from the locale.
 */
export const DirectionProvider = RadixDirectionProvider;
