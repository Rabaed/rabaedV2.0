import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `ghost` → tertiary, `subtle`/`outline` → secondary (legacy aliases). @default 'primary' */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost' | 'subtle';
  /** sm 28px · md 34px · lg 40px. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Icon node rendered at the start (mirrors in RTL). */
  iconLeft?: React.ReactNode;
  /** Icon node rendered at the end (mirrors in RTL). */
  iconRight?: React.ReactNode;
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  /** Centered spinner; keeps the button width and blocks interaction. */
  loading?: boolean;
}

/**
 * Rabaed action button — "Compact utility": 34px, r6, tomato primary, gray secondary, transparent tertiary, red danger, blue focus ring. EN + AR.
 *
 * @startingPoint section="Core" subtitle="Compact utility buttons — all states, EN + AR" viewport="900x520"
 */
export function Button(props: ButtonProps): React.ReactElement;
export default Button;
