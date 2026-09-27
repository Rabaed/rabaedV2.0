import * as React from 'react';

export interface SelectOption { label?: string; value?: string; /** Badge shown before the label, e.g. "MAR". */ code?: string; }

export interface SelectProps {
  label?: string;
  placeholder?: string;
  value?: string;
  /** Array of `{label,value,code}` or plain strings. */
  options?: Array<SelectOption | string>;
  onChange?: (value: string) => void;
  /** outline · filled · inset — same as Input. @default 'outline' */
  variant?: 'outline' | 'filled' | 'inset';
  size?: 'sm' | 'md';
  icon?: string;
  hint?: string;
  error?: boolean | string;
  required?: boolean;
  optional?: boolean;
  optionalText?: string;
  disabled?: boolean;
  /** Start open (for specimens). */
  defaultOpen?: boolean;
  style?: React.CSSProperties;
}

/** Surface-aware dropdown select (outline · filled · inset) with optional code badges. */
export function Select(props: SelectProps): React.ReactElement;
export default Select;
