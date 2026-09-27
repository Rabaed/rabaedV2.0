import * as React from 'react';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Single trailing label. */
  label?: string;
  /** Two-sided labels `[start, end]` — e.g. ['Submittal','Inspection']. */
  labels?: [string, string] | null;
  disabled?: boolean;
  /** md 32×18 · lg 36×20. @default 'md' */
  size?: 'md' | 'lg';
  style?: React.CSSProperties;
}

/** Tomato toggle switch (keyboard + focus ring, RTL-aware), single- or dual-label. */
export function Switch(props: SwitchProps): React.ReactElement;
export default Switch;
