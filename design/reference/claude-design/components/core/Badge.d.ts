import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone → tonal hue (brand=tomato, success=green, danger=red, warning=amber, info=blue, pending=violet, neutral=gray). @default 'neutral' */
  tone?: 'brand' | 'success' | 'danger' | 'warning' | 'info' | 'pending' | 'neutral' | 'accent' | 'cyan' | 'orange';
  /** `soft` tint (default) or `solid` for final/decided states. @default 'soft' */
  variant?: 'soft' | 'solid';
  /** Leading status dot. */
  dot?: boolean;
}

/** Tonal-tint status badge (24px · r7). */
export function Badge(props: BadgeProps): React.ReactElement;
export default Badge;
