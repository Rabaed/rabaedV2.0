import * as React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: string;
  /** outline (default · tables/filters) · filled (long forms) · inset (label inside, 48px · create/edit). */
  variant?: 'outline' | 'filled' | 'inset';
  /** sm 28 · md 34 (inset is always 48). @default 'md' */
  size?: 'sm' | 'md';
  /** Leading icon name. */
  icon?: string;
  /** Leading text addon, e.g. "AED". */
  prefix?: React.ReactNode;
  /** Trailing node. */
  suffix?: React.ReactNode;
  /** Keyboard hint badge, e.g. "/". */
  shortcut?: string;
  hint?: string;
  /** true or an error message. */
  error?: boolean | string;
  success?: boolean;
  required?: boolean;
  /** Shows "Optional" at the label end. */
  optional?: boolean;
  optionalText?: string;
  readOnly?: boolean;
  /** Render a textarea. */
  multiline?: boolean;
  rows?: number;
  /** Shows a character counter. */
  maxLength?: number;
  inputStyle?: React.CSSProperties;
}

/** Surface-aware text field / textarea in three looks (outline · filled · inset). Wrap regions in .surface-gray or .theme-dark to adapt. */
export function Input(props: InputProps): React.ReactElement;
export default Input;
