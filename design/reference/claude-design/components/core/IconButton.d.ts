import * as React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon name (see Icon). @default 'more-vertical' */
  icon?: string;
  /** Same variants as Button. Legacy: solid→primary, soft/outline→secondary, ghost→tertiary. @default 'tertiary' */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'solid' | 'soft' | 'outline' | 'ghost';
  /** sm 28 · md 34 · lg 40. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label (also the tooltip). */
  label?: string;
  /** Render in the toggled/active state. */
  active?: boolean;
}

/** Square icon-only button (Compact utility) for toolbars and table rows. */
export function IconButton(props: IconButtonProps): React.ReactElement;
export default IconButton;
