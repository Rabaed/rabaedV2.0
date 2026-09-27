import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Inner padding (px). @default 20 */
  padding?: number;
  /** Add hover lift + pointer cursor. */
  interactive?: boolean;
  /** Shadow depth. @default 'sm' */
  elevation?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
}

/** White surface container with hairline border and soft shadow. */
export function Card(props: CardProps): React.ReactElement;
export default Card;
