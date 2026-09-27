import * as React from 'react';

export interface CheckboxProps {
  checked?: boolean;
  /** Partly-selected state (minus mark). */
  indeterminate?: boolean;
  onChange?: (checked: boolean, e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  disabled?: boolean;
  /** md 16px · lg 18px (use lg with inset fields). @default 'md' */
  size?: 'md' | 'lg';
  style?: React.CSSProperties;
}

/** Tomato checkbox with indeterminate + focus ring; surface-aware. */
export function Checkbox(props: CheckboxProps): React.ReactElement;
export default Checkbox;
