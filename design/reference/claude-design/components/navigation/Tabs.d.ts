import * as React from 'react';

export interface TabItem {
  label: string;
  /** Stable id (defaults to label). */
  value?: string;
  /** Icon name. */
  icon?: string;
  /** Optional count pill. */
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  /** Active tab value. */
  value?: string;
  /** Called with the new value. */
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Project module tab bar (SaaS shell style): 52h, 28px gaps, tomato active underline, RTL-aware, hidden-scrollbar overflow. */
export function Tabs(props: TabsProps): React.ReactElement;
export default Tabs;
