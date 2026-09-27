import * as React from 'react';

export interface RadioProps {
  checked?: boolean;
  /** Called with `value` when selected. */
  onChange?: (value: any, e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  name?: string;
  value?: any;
  disabled?: boolean;
  /** md 16px · lg 18px. @default 'md' */
  size?: 'md' | 'lg';
  style?: React.CSSProperties;
}

/** Tomato radio button; surface-aware. */
export function Radio(props: RadioProps): React.ReactElement;
export default Radio;
