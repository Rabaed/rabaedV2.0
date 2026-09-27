import * as React from 'react';

export interface SegmentedOption { label: string; value?: string; /** Tabler icon name without "ti-". */ icon?: string; }

export interface SegmentedProps {
  options: Array<SegmentedOption | string>;
  value?: string;
  onChange?: (value: string) => void;
  /** sm 24 · md 28. @default 'md' */
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}

/** One-of-N segmented control (e.g. Kanban / List). */
export function Segmented(props: SegmentedProps): React.ReactElement;
export default Segmented;
