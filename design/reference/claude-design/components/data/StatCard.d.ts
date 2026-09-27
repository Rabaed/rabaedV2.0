import * as React from 'react';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Metric caption. */
  label?: string;
  /** Headline value (Plex, tabular). */
  value?: React.ReactNode;
  /** Small supporting line under the label. */
  sublabel?: string;
  /** Icon name. @default 'chart-bar' */
  icon?: string;
  /** Icon hue from the tonal set. Legacy pastel names still accepted. @default 'tomato' */
  tint?: 'tomato' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'cyan' | 'orange' | 'gray'
    | 'lavender' | 'mint' | 'blush' | 'butter' | 'sky' | 'slate';
  /** Optional trend pill. `good` defaults to dir==='up'. */
  trend?: { value: string; dir?: 'up' | 'down'; good?: boolean };
}

/**
 * White KPI tile with a tonal icon and optional trend.
 *
 * @startingPoint section="Data" subtitle="KPI / metric tile" viewport="700x170"
 */
export function StatCard(props: StatCardProps): React.ReactElement;
export default StatCard;
