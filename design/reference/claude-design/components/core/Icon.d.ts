import * as React from 'react';

export interface IconProps extends React.HTMLAttributes<HTMLElement> {
  /** Semantic icon name (curated product set) or a raw Tabler id. @default 'search' */
  name?: string;
  /** Pixel size. @default 20 */
  size?: number;
  /** Colour (defaults to currentColor). */
  color?: string;
}

/** Rabaed icon — Tabler webfont mapped to the product's Vuesax/Iconsax-linear set. */
export function Icon(props: IconProps): React.ReactElement;
export default Icon;
